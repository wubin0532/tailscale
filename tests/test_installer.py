import gzip, hashlib, io, os, re, subprocess, tarfile, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
HEADER=(ROOT/'packaging/run-header.sh').read_text()
INSTALLER=(ROOT/'packaging/install.sh').read_text().replace('@CORE_VERSION@','1.104.1')

def write(path,text,executable=False):
 path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);path.chmod(0o755 if executable else 0o644)

class RunHeaderTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
  stream=io.BytesIO()
  with tarfile.open(fileobj=stream,mode='w') as t:
   d=b'example';m=tarfile.TarInfo('data/example');m.size=len(d);t.addfile(m,io.BytesIO(d))
  self.payload=gzip.compress(stream.getvalue(),mtime=0)
  self.run=self.base/'test.run'
  self.run.write_bytes(HEADER.replace('@VERSION@','2.0.0-r2').replace('@ARCH@','arm64').replace('@TEMP_KB@','1').replace('@SHA256@',hashlib.sha256(self.payload).hexdigest()).encode()+self.payload)
 def tearDown(self):self.tmp.cleanup()
 def command(self,*args):return subprocess.run(['sh',str(self.run),*map(str,args)],text=True,capture_output=True)
 def test_valid_payload_and_extract(self):
  self.assertEqual(self.command('--check').returncode,0)
  target=self.base/'extract';self.assertEqual(self.command('--extract',target).returncode,0)
  self.assertEqual((target/'data/example').read_text(),'example')
 def test_corruption_rejected_before_extract(self):
  b=bytearray(self.run.read_bytes());b[-9]^=1;self.run.write_bytes(b)
  target=self.base/'extract';result=self.command('--extract',target)
  self.assertNotEqual(result.returncode,0);self.assertFalse(target.exists())
 def test_existing_destination_untouched(self):
  target=self.base/'extract';target.mkdir();write(target/'keep','unchanged')
  self.assertNotEqual(self.command('--extract',target).returncode,0);self.assertEqual((target/'keep').read_text(),'unchanged')
 def test_symlink_destination_rejected(self):
  target=self.base/'extract';target.symlink_to(self.base/'absent')
  self.assertNotEqual(self.command('--extract',target).returncode,0);self.assertFalse((self.base/'absent').exists())
 def test_unknown_option_does_not_extract(self):self.assertNotEqual(self.command('--erase').returncode,0)

class InstallerTransactionTests(unittest.TestCase):
 """Execute the real installer in a redirected filesystem with fake firmware services."""
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.router=self.base/'router';self.stage=self.base/'stage';self.bin=self.base/'bin'
  self.router.mkdir();self.stage.mkdir();self.bin.mkdir()
  for path in ['lib/functions.sh','etc/rc.common','etc/init.d/firewall','etc/init.d/rpcd']:
   write(self.router/path,'#!/bin/sh\nexit 0\n',True)
  (self.router/'usr/share/luci').mkdir(parents=True)
  (self.router/'dev/net').mkdir(parents=True);write(self.router/'dev/net/tun','mock')
  write(self.router/'etc/config/tailscale',"config settings 'settings'\noption hostname 'preserved'\n",False)
  write(self.router/'etc/config/firewall','manual firewall\n')
  write(self.router/'etc/tailscale/tailscaled.state','fresh identity\n')
  write(self.router/'etc/init.d/tailscale','#!/bin/sh\nexit 0\n',True)
  write(self.router/'usr/sbin/tailscaled','old core')
  for cmd,text in {'id':'echo 0','uci':'exit 0','ubus':'exit 0','procd':'exit 0','fw4':'exit 0','pidof':'exit 0','df':"echo 'Filesystem 1024-blocks Used Available Capacity Mounted'; echo 'overlay 1000000 100 999900 0% /'",'sleep':'exit 0'}.items():write(self.bin/cmd,'#!/bin/sh\n'+text+'\n',True)
  runtime=self.stage/'data/usr/lib/tailscale-luci/runtime'
  write(runtime/'lib/ld-musl-test.so.1','#!/bin/sh\nshift 2\nexec "$@"\n',True)
  for path,text in {'usr/bin/curl':'echo curl','usr/libexec/ip-full':'echo ip','usr/bin/jsonfilter':'cat >/dev/null; echo true','usr/bin/util-linux-flock':'exit 0','bin/curl':'echo status'}.items():write(runtime/path,'#!/bin/sh\n'+text+'\n',True)
  write(self.stage/'data/usr/sbin/tailscaled','#!/bin/sh\necho 1.104.1\n',True)
  (self.stage/'data/usr/sbin/tailscale').symlink_to('tailscaled')
  write(self.stage/'data/etc/config/tailscale','new default config\n')
  write(self.stage/'data/etc/init.d/tailscale','#!/bin/sh\nexit 0\n',True)
  write(self.stage/'data/usr/share/tailscale-luci/installed-files','')
  source=INSTALLER
  # Target paths only; shell commands such as /bin/sh continue to execute on host.
  source=re.sub(r'(?<![\w$])(/var/run|/usr|/etc|/root|/dev|/lib|/tmp/luci)(?=/|\b)',lambda m:str(self.router)+m.group(1),source)
  source=source.replace('-C /','-C "'+str(self.router)+'"')
  source=source.replace('[ -c '+str(self.router)+'/dev/net/tun ]','[ -f '+str(self.router)+'/dev/net/tun ]')
  # File manifests always contain paths relative to the firmware root.
  source=source.replace('"/$path"','"'+str(self.router)+'/$path"')
  source=source.replace('"${path#/}"','"${path#'+str(self.router)+'/}"')
  write(self.base/'install.sh',source)
 def tearDown(self):self.tmp.cleanup()
 def install(self):
  files=[p for p in sorted((self.stage/'data').rglob('*')) if p.is_file() or p.is_symlink()]
  write(self.stage/'FILES',''.join(p.relative_to(self.stage/'data').as_posix()+'\n' for p in files))
  write(self.stage/'SHA256SUMS',''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(self.stage/'data').as_posix()+'\n' for p in files if not p.is_symlink()))
  return subprocess.run(['sh',str(self.base/'install.sh'),str(self.stage),'arm64','2.0.0-r2'],capture_output=True,text=True,env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH']})
 def test_upgrade_retains_identity_config_and_firewall(self):
  result=self.install();self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertIn('preserved',(self.router/'etc/config/tailscale').read_text())
  self.assertEqual((self.router/'etc/tailscale/tailscaled.state').read_text(),'fresh identity\n')
  self.assertEqual((self.router/'etc/config/firewall').read_text(),'manual firewall\n')
  self.assertTrue((self.router/'usr/sbin/tailscale').is_symlink())
 def test_service_start_failure_restores_old_files(self):
  write(self.stage/'data/etc/init.d/tailscale','#!/bin/sh\n[ "$1" != start ]\n',True)
  result=self.install();self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertIn('restoring previous files',result.stderr)
  self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')
  self.assertEqual((self.router/'etc/config/firewall').read_text(),'manual firewall\n')
  self.assertIn('preserved',(self.router/'etc/config/tailscale').read_text())
 def test_opkg_removal_failure_restores_metadata_and_files(self):
  record='Package: tailscale-luci\nVersion: 2.0.0-1\nStatus: install user installed\n\n'
  write(self.router/'usr/lib/opkg/status',record)
  write(self.router/'usr/lib/opkg/info/tailscale-luci.list','/usr/sbin/tailscaled\n/etc/config/tailscale\n')
  write(self.router/'usr/lib/opkg/info/tailscale-luci.prerm','old script')
  command='#!/bin/sh\nif [ "$1" = status ]; then [ "$2" != tailscale-luci ] || cat "'+str(self.router)+'/usr/lib/opkg/status"; exit 0; fi\nif [ "$1" = remove ]; then rm -f "'+str(self.router)+'/usr/sbin/tailscaled" "'+str(self.router)+'/usr/lib/opkg/info/tailscale-luci.list"; : > "'+str(self.router)+'/usr/lib/opkg/status"; exit 1; fi\n'
  write(self.bin/'opkg',command,True)
  result=self.install();self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')
  self.assertEqual((self.router/'usr/lib/opkg/status').read_text(),record)
  self.assertIn('/usr/sbin/tailscaled',(self.router/'usr/lib/opkg/info/tailscale-luci.list').read_text())
 def test_failed_upgrade_restores_previous_autostart_links(self):
  rc=self.router/'etc/rc.d';rc.mkdir()
  (rc/'S95tailscale').symlink_to('../init.d/tailscale')
  script='#!/bin/sh\ncase "$1" in enable) ln -s ../init.d/tailscale "'+str(rc)+'/S99tailscale";; disable) rm -f "'+str(rc)+'/S99tailscale";; start) exit 1;; esac\nexit 0\n'
  write(self.stage/'data/etc/init.d/tailscale',script,True)
  result=self.install();self.assertNotEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertTrue((rc/'S95tailscale').is_symlink())
  self.assertFalse((rc/'S99tailscale').is_symlink())
 def test_missing_framework_leaves_old_service(self):
  (self.router/'etc/rc.common').unlink();result=self.install()
  self.assertNotEqual(result.returncode,0);self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')
 def test_insufficient_storage_leaves_old_service(self):
  write(self.bin/'df',"#!/bin/sh\necho 'overlay 10000 9999 1 100% /'\n",True)
  result=self.install();self.assertNotEqual(result.returncode,0);self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')
 def test_lock_contention_leaves_old_service(self):
  write(self.stage/'data/usr/lib/tailscale-luci/runtime/usr/bin/util-linux-flock','#!/bin/sh\nexit 1\n',True)
  result=self.install();self.assertNotEqual(result.returncode,0);self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')
 def test_manifest_traversal_rejected(self):
  # An old manifest is also validated before removal.
  write(self.router/'usr/share/tailscale-luci/installed-files','../victim\n')
  result=self.install();self.assertNotEqual(result.returncode,0);self.assertEqual((self.router/'usr/sbin/tailscaled').read_text(),'old core')

if __name__=='__main__':unittest.main()
