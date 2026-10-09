import os, subprocess, tempfile, unittest
from pathlib import Path
from test_backend import HELPER
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
ts_pref() { echo true; }
ts_check_conflicts() { echo conflict >> "$TS_RUN_DIR/events"; return 1; }
ts_run() { echo "$*" >> "$TS_RUN_DIR/events"; }
'''
   p=subprocess.run(['sh'],input=HELPER+'\n'+pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
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
ts_pref() { echo false; }
'''
   p=subprocess.run(['sh'],input=HELPER+'\n'+pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertEqual(Path(tmp,'events').read_text().splitlines(),['apply','apply'])
class WatchConcurrencyTests(unittest.TestCase):
 def test_refresh_busy_does_not_disable_routes(self):
  with tempfile.TemporaryDirectory(prefix='ts-watch-busy-') as tmp:
   pre='''
cycle=0
sleep() { cycle=$((cycle+1)); [ "$cycle" -lt 2 ]; }
md5sum() { echo stable; }
ts_apply() { :; }
ts_backend_state() { echo Running; }
ts_pref() { echo true; }
ts_check_conflicts() { return 2; }
ts_run() { echo BAD > "$TS_RUN_DIR/disabled"; }
'''
   p=subprocess.run(['sh'],input=HELPER+'\n'+pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertFalse(Path(tmp,'disabled').exists())
 def test_failed_snapshot_is_not_control_recovery(self):
  with tempfile.TemporaryDirectory(prefix='ts-watch-read-') as tmp:
   pre='''
cycle=0
sleep() { cycle=$((cycle+1)); [ "$cycle" -lt 3 ]; }
md5sum() { echo stable; }
ts_apply() { echo apply >> "$TS_RUN_DIR/events"; }
ts_backend_state() { [ "$cycle" = 1 ] || echo Running; }
ts_pref() { echo false; }
'''
   p=subprocess.run(['sh'],input=HELPER+'\n'+pre+WATCH,text=True,capture_output=True,env=os.environ|{'TS_RUN_DIR':tmp})
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertEqual(Path(tmp,'events').read_text().splitlines(),['apply'])
if __name__=='__main__'  :unittest.main()
