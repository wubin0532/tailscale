import http.server, json, os, socketserver, stat, subprocess, tempfile, threading, unittest
from pathlib import Path
from test_backend import HELPER

class UnixHTTP(socketserver.UnixStreamServer):
    pass

class LocalAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ts-api-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.count = 0
        self.status = {'BackendState':'Running','Self':{'Online':True},'Peer':{'home':{'HostName':'Home','Online':False}}}
        self.prefs = {'RouteAll':True,'ControlURL':'https://controlplane.tailscale.com','AdvertiseRoutes':['192.168.199.0/24'],'Persist':{'PrivateNodeKey':'secret-never-cache'}}
        owner = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                owner.count += 1
                if self.headers.get('Host') != 'local-tailscaled.sock':
                    self.send_error(403); return
                self.send_response(200); self.end_headers()
                v = owner.status if self.path.endswith('/status') else owner.prefs
                self.wfile.write((v if isinstance(v,str) else json.dumps(v)).encode())
        self.server = UnixHTTP(str(self.root/'sock'), Handler)
        thread = threading.Thread(target=self.server.serve_forever, daemon=True); thread.start()
        self.addCleanup(self.server.server_close); self.addCleanup(self.server.shutdown)
        filt = self.root/'jsonfilter'
        filt.write_text('''#!/usr/bin/env python3
import sys,json
args=sys.argv[1:]
try:
 d=json.loads(args[args.index('-s')+1]) if '-s' in args else json.load(open(args[args.index('-i')+1])) if '-i' in args else json.load(sys.stdin)
 field=args[args.index('-e')+1].replace('@.','').replace('[*]','')
 for key in field.split('.'): d=d[key]
 for v in d if isinstance(d,list) else [d]: print(str(v).lower() if isinstance(v,bool) else v)
except Exception: sys.exit(1)
'''); filt.chmod(0o755)
        self.env = os.environ|{'TS_RUN_DIR':str(self.root/'run'),'TS_SOCKET':str(self.root/'sock'),'PATH':str(self.root)+':'+os.environ['PATH']}
    def run_code(self, code):
        p=subprocess.run(['sh'],input=HELPER+'\n'+'''ts_metadata() { python3 -c 'import json,sys; p=json.loads(sys.argv[1]); print(json.dumps({"accept":p["RouteAll"],"server":p.get("ControlURL",""),"routes":p.get("AdvertiseRoutes",[]),"fetched_at":int(sys.argv[2]),"epoch":sys.argv[3]}))' "$1" "$2" "$3"; }\n'''+code,text=True,capture_output=True,env=self.env)
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        return p.stdout.strip()
    def test_snapshot_reused_and_invalidated(self):
        self.run_code('ts_snapshot; ts_snapshot; ts_invalidate; ts_snapshot')
        self.assertEqual(self.count,4)
    def test_filtered_prefs_and_permissions(self):
        out=self.run_code('ts_snapshot; ts_pref accept; ts_pref server; ts_pref routes')
        self.assertIn('true',out);self.assertIn('192.168.199.0/24',out)
        for p in (self.root/'run').iterdir():
            self.assertNotIn('secret-never-cache',p.read_text())
            self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o600)
        self.assertEqual(stat.S_IMODE((self.root/'run').stat().st_mode),0o700)
    def test_bad_status_keeps_previous_and_marks_stale(self):
        self.run_code('ts_snapshot')
        self.status='broken-json'
        out=self.run_code('ts_invalidate; ts_snapshot; r=$?; echo "$r:$TS_SNAPSHOT_STALE"; cat "$TS_RUN_DIR/snapshot-status"')
        self.assertIn('1:1',out);self.assertIn('Home',out)
    def test_invalid_preferences_rejected(self):
        self.prefs='bad-json'
        self.run_code('ts_snapshot && exit 1; [ ! -f "$TS_RUN_DIR/snapshot-status" ]')
    def test_concurrent_refresh_never_confirms_stale_routes(self):
        out=self.run_code('mkdir -p "$TS_RUN_DIR"; exec 8> "$TS_RUN_DIR/snapshot.lock"; flock -n 8; ts_snapshot; echo "$?:$TS_SNAPSHOT_STALE"')
        self.assertEqual(out,'2:1');self.assertEqual(self.count,0)
    def test_dead_owner_kernel_lock_releases(self):
        p=subprocess.run(['sh','-c','mkdir -p "$TS_RUN_DIR"; exec 9> "$TS_RUN_DIR/snapshot.lock"; flock -n 9; kill -KILL $$'],env=self.env,capture_output=True)
        self.assertNotEqual(p.returncode,0)
        self.run_code('ts_snapshot')
        self.assertEqual(self.count,2)
    def test_large_json_does_not_use_argv(self):
        self.status['Padding']='x'*1200000
        self.run_code('ts_snapshot; ts_backend_state')
        self.assertEqual(self.count,2)
        self.assertEqual(json.loads((self.root/'run'/'snapshot-status').read_text())['BackendState'],'Running')
    def test_legacy_rpc_json_quote_roundtrip(self):
        self.status['Padding']='x'*1200000
        self.status['Self']['HostName']='quotes " and \\ newline \n tab \t'
        out=self.run_code('ts_snapshot; ts_json_quote < "$TS_RUN_DIR/snapshot-status"')
        self.assertEqual(json.loads(json.loads(out))['Self']['HostName'],self.status['Self']['HostName'])
    def test_simultaneous_cold_refresh_is_serialized(self):
        code=HELPER+'\n'+'''ts_metadata() { echo '{"epoch":"","fetched_at":1,"accept":true,"routes":[]}'; }
ts_api() { sleep .3; curl -fsS --noproxy '*' --unix-socket "$TS_SOCKET" "http://local-tailscaled.sock/localapi/v0/$1"; }
ts_snapshot; echo "$?"
'''
        a=subprocess.Popen(['sh'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=self.env)
        b=subprocess.Popen(['sh'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=self.env)
        a.stdin.write(code);a.stdin.close();b.stdin.write(code);b.stdin.close()
        a.wait(timeout=5);b.wait(timeout=5)
        outputs=[a.stdout.read().strip(),b.stdout.read().strip()]
        for p in [a,b]: p.stdout.close();p.stderr.close()
        self.assertEqual(sorted(outputs),['0','2']);self.assertEqual(self.count,2)
    def test_publish_failure_keeps_previous_complete_snapshot(self):
        self.run_code('ts_snapshot')
        before=(self.root/'run'/'snapshot-status').read_text()
        out=self.run_code('ts_invalidate; mv() { return 1; }; ts_snapshot; echo "$?:$TS_SNAPSHOT_STALE"')
        self.assertEqual(out,'1:1');self.assertEqual((self.root/'run'/'snapshot-status').read_text(),before)
    def test_inflight_refresh_cannot_override_invalidation(self):
        out=self.run_code('''original_api() { curl -fsS --noproxy '*' --unix-socket "$TS_SOCKET" "http://local-tailscaled.sock/localapi/v0/$1"; }
ts_api() { if [ "$1" = prefs ]; then ts_invalidate; fi; original_api "$1"; }
ts_snapshot; echo "$?:$TS_SNAPSHOT_STALE"; [ ! -f "$TS_RUN_DIR/snapshot-status" ]
''')
        self.assertEqual(out,'2:1')
    def test_routine_reads_never_call_cli(self):
        out=self.run_code('TS_CLI=false; ts_backend_state; ts_pref accept')
        self.assertEqual(out,'Running\ntrue')

if __name__=='__main__': unittest.main()
