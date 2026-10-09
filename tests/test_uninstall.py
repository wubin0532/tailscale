"""Execute the real remover with an isolated firmware filesystem and UCI model."""
import json, os, re, subprocess, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'luci-app-tailscale/root/usr/lib/tailscale-luci-uninstall.sh').read_text()

def write(path,text,executable=False):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);path.chmod(0o755 if executable else 0o644)

class UninstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve()/'router';self.bin=Path(self.tmp.name).resolve()/'bin';self.bin.mkdir()
        for path in ['etc/rc.common','etc/init.d/firewall','etc/init.d/rpcd','etc/init.d/tailscale']:
            write(self.root/path,'#!/bin/sh\nexit 0\n',True)
        for path,text in [('etc/config/tailscale','config settings'),('etc/tailscale/tailscaled.state','fixture identity'),('usr/sbin/tailscaled','fixture core'),('usr/lib/tailscale-luci.sh','exit 2'),('usr/lib/tailscale-luci/runtime/lib/shared.so','private'),('root/tailscale-backup-v2/old/config','old identity'),('tmp/lib/tailscale/tailscaled.log1.txt','log'),('usr/share/istore/run-records/owned.txt','{}\ntailscale-luci-run\n'),('usr/share/istore/run-records/shared.txt','{}\ntailscale-luci-run\nother-app\n'),('usr/lib/shared-other-app.so','keep'),('etc/config/firewall','fixture firewall')]:
            write(self.root/path,text)
        write(self.root/'usr/share/tailscale-luci/installed-files','etc/config/tailscale\nusr/sbin/tailscaled\nusr/lib/tailscale-luci.sh\n')
        self.model={'firewall':{'zone':[{'name':'lan'},{'name':'wan'},{'name':'tailscale','ts_auto':'1'}], 'forwarding':[{'src':'lan','dest':'wan'},{'src':'lan','dest':'tailscale','ts_auto':'1'}], 'rule':[{'src':'lan','name':'other'},{'src':'tailscale','name':'manual-ts'}], 'redirect':[]},'network':{'interface':[{'device':'br-lan'},{'device':'tailscale0'}]}}
        self.model_file=self.root/'uci.json';self.save()
        uci=r'''import json,os,re,sys
from pathlib import Path
p=Path(os.environ['FIXTURE_ROOT'])/'uci.json';data=json.loads(p.read_text());args=[a for a in sys.argv[1:] if a!='-q'];action=args[0]
if action=='changes': print(os.environ.get('PENDING',''));sys.exit(0)
if action=='commit': sys.exit(0)
key=args[1]
if key=='tailscale.settings.state_file': print(os.environ.get('STATE_PATH',''));sys.exit(0)
m=re.fullmatch(r'(firewall|network)\.@(\w+)\[(\d+)\](?:\.(\w+))?',key)
if not m:sys.exit(1)
cfg,kind,index,option=m.groups();rows=data[cfg].get(kind,[]);index=int(index)
if index>=len(rows):sys.exit(1)
if action=='delete':rows.pop(index);p.write_text(json.dumps(data));sys.exit(0)
if option:
 if option not in rows[index]:sys.exit(1)
 print(rows[index][option])
else: print(kind)
'''
        write(self.bin/'uci','#!'+sys.executable+'\n'+uci,True)
        for command,body in {'id':'echo 0','ubus':'exit 0','pidof':'exit 1','sleep':'/bin/sleep 0.01','nft':'[ "$1" != list ]','flock':'[ "${LOCK_BUSY:-0}" != 1 ]'}.items():
            write(self.bin/command,'#!/bin/sh\n'+body+'\n',True)
        source=re.sub(r'(?<![\w$])(/var/run|/usr|/etc|/root|/tmp|/sys)(?=/|\b)',lambda m:str(self.root)+m.group(1),SOURCE)
        source=source.replace('"/$path"','"'+str(self.root)+'/$path"')
        self.script=Path(self.tmp.name)/'uninstall.sh';write(self.script,source)
        self.env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],'FIXTURE_ROOT':str(self.root),'STATE_PATH':str(self.root/'etc/tailscale/tailscaled.state')}
    def save(self):self.model_file.write_text(json.dumps(self.model))
    def run_uninstall(self,*args,**env):
        return subprocess.run(['sh',str(self.script),*args],capture_output=True,text=True,timeout=15,env=self.env|env)
    def test_purge_cleans_identity_private_dependencies_and_rules(self):
        result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
        for path in ['usr/sbin/tailscaled','usr/lib/tailscale-luci','etc/config/tailscale','etc/tailscale','root/tailscale-backup-v2','tmp/lib/tailscale','usr/share/istore/run-records/owned.txt']:
            self.assertFalse((self.root/path).exists(),path)
        self.assertTrue((self.root/'usr/lib/shared-other-app.so').exists())
        self.assertTrue((self.root/'usr/share/istore/run-records/shared.txt').exists())
        model=json.loads(self.model_file.read_text())
        self.assertEqual([z['name'] for z in model['firewall']['zone']],['lan','wan'])
        self.assertEqual(model['firewall']['forwarding'],[{'src':'lan','dest':'wan'}])
        self.assertEqual(model['network']['interface'],[{'device':'br-lan'}])
    def test_keep_state_preserves_identity_backups_and_manual_rules(self):
        result=self.run_uninstall('--keep-state');self.assertEqual(result.returncode,0,result.stderr)
        for path in ['etc/config/tailscale','etc/tailscale/tailscaled.state','root/tailscale-backup-v2/old/config']:
            self.assertTrue((self.root/path).exists(),path)
        rules=json.loads(self.model_file.read_text())['firewall']['rule']
        self.assertEqual(len(rules),2)
    def test_missing_config_and_helper_do_not_abort_removal(self):
        (self.root/'etc/config/tailscale').unlink();(self.root/'usr/lib/tailscale-luci.sh').unlink()
        result=self.run_uninstall(STATE_PATH='');self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse((self.root/'usr/sbin/tailscaled').exists())
    def test_missing_manifest_and_init_recover(self):
        (self.root/'usr/share/tailscale-luci/installed-files').unlink();(self.root/'etc/init.d/tailscale').unlink()
        result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
        self.assertFalse((self.root/'usr/sbin/tailscaled').exists())
    def test_repeated_removal_is_idempotent(self):
        for _ in range(2):
            result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
    def test_bad_manifest_rejected_before_service_stop(self):
        write(self.root/'usr/share/tailscale-luci/installed-files','../other-app\n')
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'usr/sbin/tailscaled').exists())
    def test_symlink_parent_cannot_escape_owned_tree(self):
        victim=Path(self.tmp.name)/'victim';victim.mkdir();write(victim/'keep','keep')
        (self.root/'usr/share/tailscale-luci/installed-files').write_text('usr/lib/tailscale-luci/redirect/keep\n')
        (self.root/'usr/lib/tailscale-luci/redirect').symlink_to(victim)
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertEqual((victim/'keep').read_text(),'keep')
    def test_pending_edits_and_operation_lock_refuse(self):
        for env in [{'PENDING':'firewall.user.dest=wan'},{'LOCK_BUSY':'1'}]:
            result=self.run_uninstall(**env);self.assertNotEqual(result.returncode,0)
            self.assertTrue((self.root/'usr/sbin/tailscaled').exists())
    def test_unsafe_custom_state_refused(self):
        result=self.run_uninstall(STATE_PATH=str(self.root/'etc/config/firewall'))
        self.assertNotEqual(result.returncode,0);self.assertTrue((self.root/'etc/config/firewall').exists())
    def test_firewall_reload_failure_keeps_program_for_retry(self):
        write(self.root/'etc/init.d/firewall','#!/bin/sh\nexit 9\n',True)
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'usr/sbin/tailscaled').exists())
    def test_stuck_daemon_keeps_files(self):
        write(self.bin/'pidof','#!/bin/sh\necho 123; exit 0\n',True)
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'usr/sbin/tailscaled').exists())
    def test_failed_init_stop_uses_procd(self):
        write(self.root/'etc/init.d/tailscale','#!/bin/sh\nexit 2\n',True)
        result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
    def test_running_route_watcher_refuses_removal(self):
        write(self.bin/'ubus', '''#!/bin/sh
if [ "$3" = list ]; then echo '{"tailscale":{"instances":{"route_guard":{"running":true}}}}'; fi
exit 0
''',True)
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'usr/sbin/tailscaled').exists())
    def test_stale_chains_removed_without_flushing_tables(self):
        write(self.bin/'nft','#!/bin/sh\n[ "$1" != delete ] || echo "$*" >> "$FIXTURE_ROOT/nft-calls"\nexit 0\n',True)
        result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
        calls=(self.root/'nft-calls').read_text().splitlines()
        self.assertEqual(len(calls),8)
        self.assertTrue(all(c.startswith('delete chain inet fw4 ') and c.endswith('tailscale') for c in calls))
    def test_official_cleanup_runs_before_binary_removal(self):
        write(self.root/'usr/sbin/tailscaled','#!/bin/sh\necho "$*" > "$FIXTURE_ROOT/core-cleanup"\n[ "$TS_BE_CLI" = false ]\n',True)
        result=self.run_uninstall();self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual((self.root/'core-cleanup').read_text().strip(),'--cleanup --no-logs-no-support --tun=tailscale0')
    def test_official_cleanup_failure_preserves_files(self):
        write(self.root/'usr/sbin/tailscaled','#!/bin/sh\nexit 8\n',True)
        result=self.run_uninstall();self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'usr/sbin/tailscaled').exists())

if __name__=='__main__':unittest.main()
