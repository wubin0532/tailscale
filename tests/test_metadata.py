import json, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class MetadataTests(unittest.TestCase):
 def test_versioned_views_resolve(self):
  menu=json.loads((ROOT/'luci-app-tailscale/root/usr/share/luci/menu.d/luci-app-tailscale.json').read_text())
  for entry in menu.values():
   action=entry.get('action',{})
   if action.get('type')=='view':
    p=ROOT/'luci-app-tailscale/htdocs/luci-static/resources/view'/(action['path']+'.js')
    self.assertTrue(p.is_file(),str(p));self.assertIn('-v123',str(p))
 def test_rpc_acl_matches_methods(self):
  acl=json.loads((ROOT/'luci-app-tailscale/root/usr/share/rpcd/acl.d/luci-app-tailscale.json').read_text())['luci-app-tailscale']
  self.assertIn('set_enabled',acl['write']['ubus']['tailscale'])
  self.assertNotIn('set_enabled',acl['read']['ubus']['tailscale'])
 def test_shell_syntax(self):
  import subprocess
  for p in ['etc/init.d/tailscale','usr/lib/tailscale-luci.sh','usr/libexec/rpcd/tailscale','usr/libexec/tailscale-route-watch']:
   self.assertEqual(subprocess.run(['sh','-n',str(ROOT/'luci-app-tailscale/root'/p)]).returncode,0,p)
if __name__=='__main__':unittest.main()
