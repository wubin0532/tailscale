#!/usr/bin/env python3
import json, os, subprocess, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'luci-app-tailscale/root/etc/init.d/tailscale').read_text().replace('. /usr/lib/tailscale-luci.sh',':').replace('/etc/init.d/firewall reload','mock_reload')
def item(id,type,**options):return {'id':id,'type':type,'options':options}
class FirewallTests(unittest.TestCase):
 def run_fw(self,sections,config=None,action='fw_setup',failure=None,expected=0):
  with tempfile.TemporaryDirectory(prefix='tailscale-firewall-') as tmp:
   p=Path(tmp,'uci.json');p.write_text(json.dumps({'sections':sections}));c=Path(tmp,'config.json');c.write_text(json.dumps(config or {}))
   env=os.environ|{'UCI_FIXTURE':str(p),'CONFIG_FIXTURE':str(c),'UCI_BIN':str(ROOT/'tests/fake_uci.py'),'RELOAD_CAPTURE':str(Path(tmp,'reloads')),'TS_RUN_DIR':tmp}
   if failure:env['UCI_FAIL_ONCE']=failure
   stubs=r'''
uci() { python3 "$UCI_BIN" "$@"; }
logger() { :; }
mock_reload() { echo reload >> "$RELOAD_CAPTURE"; }
config_get() {
 v=$(python3 -c 'import json,os,sys; c=json.load(open(os.environ["CONFIG_FIXTURE"]));print(c.get(sys.argv[1],sys.argv[2]))' "$3" "$4")
 eval "$1=\"\$v\""
}
config_get_bool() { config_get "$@"; }
config_list_foreach() {
 for v in $(python3 -c 'import json,os,sys;print(" ".join(json.load(open(os.environ["CONFIG_FIXTURE"])).get(sys.argv[1],[])))' "$2"); do "$3" "$v"; done
}
'''
   result=subprocess.run(['sh'],input=SOURCE+stubs+'\n'+action+'\n',text=True,capture_output=True,env=env)
   self.assertEqual(result.returncode,expected,result.stdout+result.stderr)
   return json.loads(p.read_text()),Path(tmp,'reloads').read_text() if Path(tmp,'reloads').exists() else ''
 def test_requested_defaults(self):
  state,out=self.run_fw([],{'enabled':1})
  zone=[s for s in state['sections'] if s['type']=='zone'][0]['options']
  self.assertEqual([zone[x] for x in ['input','output','forward']],['REJECT','ACCEPT','REJECT'])
  self.assertEqual(zone['device'],['tailscale0'])
  self.assertNotIn('masq_src',zone);self.assertNotIn('masq_dest',zone)
  forwards=[s['options'] for s in state['sections'] if s['type']=='forwarding']
  self.assertEqual([(f['src'],f['dest']) for f in forwards],[('lan','tailscale')])
  self.assertEqual(out.strip(),'reload');self.assertEqual(state['commits'],1)
 def test_owned_zone_updated_preserving_manual_rules(self):
  manual=item('manual','rule',name='KeepManual',src='lan',target='ACCEPT')
  old=[item('oldzone','zone',name='tailscale',input='ACCEPT',ts_auto='1'),item('oldf','forwarding',src='tailscale',dest='lan',ts_auto='1'),item('oldrule','rule',dest_port='22',ts_auto='1'),manual]
  state,out=self.run_fw(old,{'enabled':1,'input':'DROP','masq':0,'lan_forward':0,'ports':['443']})
  self.assertIn(manual,state['sections'])
  zones=[s['options'] for s in state['sections'] if s['type']=='zone'];self.assertEqual(len(zones),1);self.assertEqual(zones[0]['input'],'DROP');self.assertNotIn('masq',zones[0])
  self.assertFalse(any(s['type']=='forwarding' for s in state['sections']))
  rules=[s['options'] for s in state['sections'] if s['type']=='rule' and s['id']!='manual'];self.assertEqual([r['dest_port'] for r in rules],['443'])
  self.assertEqual(state['commits'],1);self.assertEqual(out.strip(),'reload')
 def test_manual_zone_is_preserved(self):
  zone=item('userzone','zone',name='tailscale',input='DROP',masq_src=['192.168.199.0/24'])
  state,out=self.run_fw([zone],{'enabled':1})
  self.assertEqual(state['sections'],[zone]);self.assertEqual(state.get('commits',0),0);self.assertEqual(out,'')
 def test_nat_limits_and_explicit_inbound_forward(self):
  state,_=self.run_fw([],{'enabled':1,'tailscale_to_lan':1,'masq_src':['192.168.123.0/24'],'masq_dest':['192.168.199.0/24','100.90.126.80']})
  zone=[s['options'] for s in state['sections'] if s['type']=='zone'][0]
  self.assertEqual(zone['masq_src'],['192.168.123.0/24']);self.assertEqual(zone['masq_dest'],['192.168.199.0/24','100.90.126.80'])
  self.assertEqual(len([s for s in state['sections'] if s['type']=='forwarding']),2)
 def test_disable_removes_only_owned_rules(self):
  manual=item('manual','rule',name='KeepManual')
  state,out=self.run_fw([item('z','zone',name='tailscale',ts_auto='1'),item('f','forwarding',src='lan',dest='tailscale',ts_auto='1'),manual],{'enabled':0})
  self.assertEqual(state['sections'],[manual]);self.assertEqual(state['commits'],1);self.assertEqual(out.strip(),'reload')
 def test_failed_update_restores_previous_firewall(self):
  old=[item('manual','zone',name='lan'),item('oldzone','zone',name='tailscale',input='ACCEPT',ts_auto='1')]
  state,out=self.run_fw(old,{'enabled':1},failure='set firewall.generated0.input=REJECT',expected=7)
  self.assertEqual(state['sections'],old)
  self.assertEqual(out.strip(),'reload')
 def test_repeated_apply_is_idempotent(self):
  state,_=self.run_fw([],{'enabled':1})
  again,_=self.run_fw(state['sections'],{'enabled':1})
  self.assertEqual(len(state['sections']),len(again['sections']))
  self.assertEqual([s['options'] for s in state['sections']],[s['options'] for s in again['sections']])
if __name__=='__main__':unittest.main(verbosity=2)
