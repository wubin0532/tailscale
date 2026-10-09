#!/usr/bin/env python3
import ipaddress, json, os, random, signal, subprocess, tempfile, time, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'luci-app-tailscale/root'
CHECK=BASE/'usr/libexec/tailscale-route-check.awk'
if not __import__('shutil').which('flock'):
 os.environ['PATH']=str(Path(__file__).parent)+':'+os.environ['PATH']
HELPER=(BASE/'usr/lib/tailscale-luci.sh').read_text().replace('. /lib/functions.sh 2>/dev/null || true', ':').replace('. /usr/share/libubox/jshn.sh 2>/dev/null || true', ':')
INIT=(BASE/'etc/init.d/tailscale').read_text().replace('. /usr/lib/tailscale-luci.sh', ':').replace('/etc/init.d/firewall reload','mock_reload')
RPC=(BASE/'usr/libexec/rpcd/tailscale').read_text().split('\ncase "$1"')[0].replace('. /usr/share/libubox/jshn.sh', ':').replace('. /usr/lib/tailscale-luci.sh', ':').replace('/etc/init.d/tailscale','mock_init')
def shell(code,env=None): return subprocess.run(['sh'],input=code,text=True,capture_output=True,env=env)
class RouteTests(unittest.TestCase):
 def route(self,lines): return subprocess.run(['awk','-f',str(CHECK)],input=lines,text=True,capture_output=True)
 def test_host_bits(self):
  for v in ['192.168.123.1/24','fd12::1/64','2001:db8:1::1/48']:
   with self.subTest(v=v): self.assertNotEqual(self.route('advertise '+v+'\n').returncode,0)
 def test_valid_invalid_cidr(self):
  for v in ['192.168.0.0/24','0.0.0.0/0','10.1.1.1/32','::/0','fd12::/64','::ffff:192.0.2.0/120']:
   with self.subTest(v=v): self.assertEqual(self.route('advertise '+v+'\n').returncode,0)
  for v in ['192.168.0.256/24','1.2.3.4/-1','1.2.3.4/33','192.168.001.0/24','192.168.1.0',':::/64','fd12::/129','fd12::/abc']:
   with self.subTest(v=v): self.assertNotEqual(self.route('advertise '+v+'\n').returncode,0)
 def test_overlap(self):
  cases=[('192.168.123.1/24','192.168.123.0/24',1),('192.168.123.1/24','192.168.0.0/16',1),('192.168.123.1/24','192.168.123.128/25',1),('192.168.123.1/24','192.168.199.0/24',0),('fd1f:7e08:758c::1/60','fd1f:7e08:758c::/64',1),('fd1f:7e08:758c::1/60','fd20::/16',0),('192.168.123.1/24','0.0.0.0/0',0),('fd1f::1/64','::/0',0)]
  for a,b,result in cases:
   with self.subTest(a=a,b=b): self.assertEqual(self.route(f'local {a}\nremote {b}\n').returncode!=0,bool(result))
 def test_120_randomized_pairs(self):
  rng=random.Random(199123)
  for width in [32,128]:
   for _ in range(60):
    a=ipaddress.ip_network((rng.getrandbits(width),rng.randrange(1,width+1)),strict=False)
    b=ipaddress.ip_network((int(a.network_address) if rng.randrange(2) else rng.getrandbits(width),rng.randrange(1,width+1)),strict=False)
    p=self.route(f'local {a}\nremote {b}\n')
    self.assertEqual(p.returncode!=0,a.overlaps(b),(a,b,p.stdout,p.stderr))
class HelperTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='tailscale-test-');self.addCleanup(self.tmp.cleanup)
  self.dir=Path(self.tmp.name)
  self.env=os.environ|{'TS_RUN_DIR':self.tmp.name,'TS_ROUTE_CHECK':str(CHECK),'CAPTURE':str(self.dir/'args')}
  self.common=HELPER+'''\nlogger() { :; }
ts_read_config() { :; }
ts_accept=0; ts_hostname=Office-1; ts_routes=''; ts_ssh=0; ts_offer_exit=0; ts_exit=''; ts_exit_lan=1; ts_server=''; ts_auth=''
'''
 def run_code(self,code):
  p=shell(self.common+code,self.env);self.assertEqual(p.returncode,0,p.stdout+p.stderr);return p.stdout.strip()
 def test_legacy_firewall_defaults_migrate(self):
  out=self.run_code('''
config_load() { :; }
config_get() { case "$1" in forward) forward='';; input) input=ACCEPT;; esac; }
uci() { echo "$*"; }
ts_migrate_config
''')
  self.assertEqual(out.splitlines(),['set tailscale.auto.input=REJECT','set tailscale.auto.output=ACCEPT','set tailscale.auto.forward=REJECT','set tailscale.auto.tailscale_to_lan=0','commit tailscale'])
 def test_explicit_v8_firewall_policies_preserved(self):
  out=self.run_code('''
config_load() { :; }
config_get() { forward=ACCEPT; }
uci() { echo UNEXPECTED; }
ts_migrate_config
''')
  self.assertEqual(out,'')
 def test_cli_failure_preserved(self):
  out=self.run_code('mock_cli() { echo invalid-route >&2; return 9; }\nts_run mock_cli; r=$?\n[ "$r" = 9 ] || exit 1\ncat "$TS_RUN_DIR/luci-error"\n')
  self.assertEqual(out,'invalid-route')
 def test_cli_argument_boundaries(self):
  out=self.run_code('mock_cli() { printf "<%s>\\n" "$@" > "$CAPTURE"; }\nts_run mock_cli "--hostname=Office --accept-dns=false" "--advertise-routes="\ncat "$CAPTURE"\n')
  self.assertEqual(out,'<--hostname=Office --accept-dns=false>\n<--advertise-routes=>')
 def test_invalid_name_exit_server_subnet(self):
  for code in ["ts_hostname='Office --accept-dns=false'","ts_exit='192.168.123.0/24'","ts_server='root'","ts_server='https://bad url'","ts_routes='192.168.123.1/24'"]:
   with self.subTest(code=code): self.run_code(code+'\nts_validate && exit 1\nexit 0\n')
 def test_clear_preferences_only_managed_flags(self):
  out=self.run_code('ts_run() { printf "<%s>\\n" "$@"; }\nts_set_prefs\n')
  for arg in ['--accept-routes=false','--hostname=Office-1','--advertise-routes=','--ssh=false','--advertise-exit-node=false','--exit-node=','--exit-node-allow-lan-access=false']: self.assertIn('<'+arg+'>',out)
  for arg in ['--reset','--accept-dns','--netfilter-mode']: self.assertNotIn(arg,out)
 def test_conflict_disables_route_acceptance(self):
  out=self.run_code('ts_accept=1\nts_check_conflicts() { ts_error "Remote subnet overlaps local network"; }\nts_run() { echo "$*"; }\nts_set_prefs && exit 1\ncat "$TS_RUN_DIR/luci-error"\n')
  self.assertIn('set --accept-routes=false',out);self.assertIn('overlaps',out);self.assertNotIn('--hostname',out)
 def test_wait_for_backend(self):
  (self.dir/'counter').write_text('0')
  out=self.run_code('sleep() { :; }\nts_backend_state() { n=$(cat "$TS_RUN_DIR/counter"); n=$((n+1)); echo "$n" > "$TS_RUN_DIR/counter"; if [ "$n" -gt 2 ]; then echo Running; else echo Starting; fi; }\nts_wait_backend; echo "$TS_BACKEND_STATE"\n')
  self.assertEqual(out,'Running');self.assertEqual((self.dir/'counter').read_text().strip(),'3')
 def test_backend_timeout(self): self.run_code('sleep() { :; }\nts_backend_state() { echo Starting; }\nts_wait_backend && exit 1\nexit 0\n')
 def test_operation_lock(self):
  self.run_code('ts_lock; (ts_apply && exit 1; exit 0)\n');self.assertIn('Another',(self.dir/'luci-error').read_text())
 def test_redaction(self):
  self.run_code("ts_error 'failed tskey-auth-sensitive123'\nexit 0\n");self.assertNotIn('sensitive123',(self.dir/'luci-error').read_text())
 def test_stopped_backend_resumes_without_reset(self):
  out=self.run_code('ts_wait_backend() { TS_BACKEND_STATE=Stopped; }\nmock_cli() { echo "{}"; }\nTS_CLI=mock_cli\nts_pref() { :; }\njsonfilter() { :; }\nts_run() { echo "$*"; }\nts_apply_locked\n')
  self.assertIn('mock_cli set --accept-routes=false',out);self.assertTrue(out.endswith('mock_cli up'));self.assertNotIn('--reset',out)
 def test_control_server_change_requires_logout(self):
  self.run_code('ts_wait_backend() { TS_BACKEND_STATE=Running; }\nmock_cli() { echo "{}"; }\nTS_CLI=mock_cli\nts_pref() { echo https://old.example.com; }\njsonfilter() { echo https://old.example.com; }\nts_run() { echo UNEXPECTED; }\nts_apply_locked && exit 1\nexit 0\n')
  self.assertIn('Logout',(self.dir/'luci-error').read_text())
 def test_lock_cleanup_after_apply_failure(self):
  self.run_code('ts_apply_locked() { return 7; }\nts_apply; result=$?\n[ "$result" = 7 ] && ! ts_busy\n')
 def test_stop_during_startup_cleans_operation_lock(self):
  code=self.common+'''
ts_backend_state() { echo Starting; }
ts_apply_locked() { touch "$TS_RUN_DIR/ready"; ts_wait_backend; }
ts_apply
'''
  proc=subprocess.Popen(['sh'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=self.env)
  proc.stdin.write(code);proc.stdin.close()
  for _ in range(100):
   if (self.dir/'ready').exists():break
   time.sleep(.01)
  self.assertEqual(shell(self.common+'ts_busy',self.env).returncode,0)
  proc.send_signal(signal.SIGTERM)
  proc.wait(timeout=3)
  self.assertEqual(shell(self.common+'ts_busy',self.env).returncode,1)
  proc.stdout.close();proc.stderr.close()
 def test_cli_does_not_inherit_operation_locks(self):
  script=self.dir/'check_fds.py'
  script.write_text('import os\nfor fd in [7,8,9]:\n try: os.fstat(fd)\n except OSError: continue\n raise SystemExit(7)\n')
  self.run_code('ts_lock; exec 8> "$TS_RUN_DIR/service.lock"; flock -n 8; exec 9> "$TS_RUN_DIR/snapshot.lock"; flock -n 9; ts_run python3 "'+str(script)+'"; r=$?; [ "$r" = 0 ]\n')
 def test_auth_file_private_and_removed_on_login_failure(self):
  self.run_code("ts_auth='tskey-auth-fixture'\nts_run() { for arg in \"$@\"; do case \"$arg\" in --auth-key=file:*) keyfile=${arg#--auth-key=file:}; [ -f \"$keyfile\" ] || return 88; python3 -c 'import os,sys;assert os.stat(sys.argv[1]).st_mode & 0o777 == 0o600' \"$keyfile\" || return 89;; esac; done; return 9; }\nts_login_worker; r=$?\n[ \"$r\" = 9 ] && [ -z \"$(ls \"$TS_RUN_DIR\"/authkey.* 2>/dev/null)\" ]\n")

class RpcTests(unittest.TestCase):
 def run_rpc(self,code):
  with tempfile.TemporaryDirectory(prefix='tailscale-rpc-test-') as tmp:
   pre=HELPER+'''\nCLI=mock_cli
mock_cli() { return "$CASE_CODE"; }
json_init() { :; }
json_add_boolean() { echo "$1=$2"; }
json_add_string() { [ "$CHECK_OUTPUT" != 1 ] || echo "$1=$2"; }
json_dump() { :; }
ts_clear_error() { :; }
ts_invalidate() { :; }
ts_capture() { "$@"; }
wait_service() { :; }
uci() {
 case "$1" in get) cat "$TS_RUN_DIR/enabled";; set) printf '%s' "${2#tailscale.settings.enabled=}" > "$TS_RUN_DIR/enabled";; commit) echo commit >> "$TS_RUN_DIR/events";; esac
}
mock_init() { echo "$1" >> "$TS_RUN_DIR/events"; [ "$1" != "$FAIL_ACTION" ]; }
jsonfilter() { echo "$ENABLED"; }
'''
   Path(tmp,'enabled').write_text('0');p=shell(RPC+pre+code,os.environ|{'TS_RUN_DIR':tmp});self.assertEqual(p.returncode,0,p.stdout+p.stderr);return p.stdout.strip()
 def test_service_lock_recovers_after_sigkill(self):
  with tempfile.TemporaryDirectory(prefix='ts-rpc-kill-') as tmp:
   p=shell(RPC+'\nservice_lock; kill -KILL $$\n',os.environ|{'TS_RUN_DIR':tmp})
   self.assertNotEqual(p.returncode,0)
   p=shell(RPC+'\nservice_lock\n',os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
 def test_logout_exit_code(self): self.assertEqual(self.run_rpc('CASE_CODE=0; do_logout\nCASE_CODE=9; do_logout\n'),'success=1\nsuccess=0')
 def test_enable_commit_then_start(self): self.assertEqual(self.run_rpc('ENABLED=1; FAIL_ACTION=none; do_set_enabled <<EOF\n{}\nEOF\ncat "$TS_RUN_DIR/enabled"; echo; cat "$TS_RUN_DIR/events"\n'),'success=1\n1\ncommit\nenable\nstart')
 def test_start_failure_rollback(self): self.assertEqual(self.run_rpc('ENABLED=1; FAIL_ACTION=start; do_set_enabled <<EOF\n{}\nEOF\ncat "$TS_RUN_DIR/enabled"; echo; cat "$TS_RUN_DIR/events"\n'),'success=0\n0\ncommit\nenable\nstart\ncommit\nstop\ndisable')
 def test_success_has_no_failure_message(self):
  self.assertEqual(self.run_rpc('CHECK_OUTPUT=1; ENABLED=1; FAIL_ACTION=none; do_set_enabled <<EOF\n{}\nEOF\n'),'success=1\noutput=')
 def test_invalid_enable_no_write(self): self.assertEqual(self.run_rpc('ENABLED=bad; do_set_enabled <<EOF\n{}\nEOF\n[ ! -f "$TS_RUN_DIR/events" ]\n'),'success=0')
if __name__=='__main__': unittest.main(verbosity=2)
