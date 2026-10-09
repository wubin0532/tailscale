import os, subprocess, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WATCH=(ROOT/'luci-app-tailscale/root/usr/libexec/tailscale-route-watch').read_text().replace('. /usr/lib/tailscale-luci.sh',':')
class WatchTests(unittest.TestCase):
 def test_config_reload_and_later_route_conflict(self):
  with tempfile.TemporaryDirectory(prefix='tailscale-watch-') as tmp:
   pre='''
cycle=0
TS_CLI=mock_cli
sleep() { cycle=$((cycle+1)); [ "$cycle" -lt 2 ]; }
md5sum() { echo "$cycle"; }
ts_apply() { echo apply >> "$TS_RUN_DIR/events"; }
ts_backend_state() { echo Running; }
mock_cli() { echo '{}'; }
jsonfilter() { echo true; }
ts_check_conflicts() { echo conflict >> "$TS_RUN_DIR/events"; return 1; }
ts_run() { echo "$*" >> "$TS_RUN_DIR/events"; }
'''
   p=subprocess.run(['sh'],input=pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertEqual(Path(tmp,'events').read_text().splitlines(),['apply','apply','conflict','mock_cli set --accept-routes=false'])
   self.assertFalse(Path(tmp,'luci-lock').exists())
 def test_apply_after_delayed_control_recovery(self):
  with tempfile.TemporaryDirectory(prefix='tailscale-watch-') as tmp:
   pre='''
cycle=0
TS_CLI=mock_cli
sleep() { cycle=$((cycle+1)); [ "$cycle" -lt 3 ]; }
md5sum() { echo stable; }
ts_apply() { echo apply >> "$TS_RUN_DIR/events"; }
ts_backend_state() { if [ "$cycle" -ge 2 ]; then echo Running; else echo NoState; fi; }
mock_cli() { echo '{}'; }
jsonfilter() { echo false; }
'''
   p=subprocess.run(['sh'],input=pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertEqual(Path(tmp,'events').read_text().splitlines(),['apply','apply'])
if __name__=='__main__' :unittest.main()
