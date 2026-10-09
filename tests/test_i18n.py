"""Translation coverage for the LuCI system-selected language catalog."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'luci-app-tailscale'


def catalog():
    entries = {}
    key = value = None
    active = None
    for line in (APP / 'po/zh_Hans/tailscale.po').read_text().splitlines() + ['']:
        if line.startswith('msgid '):
            key = json.loads(line[6:]); active = 'key'
        elif line.startswith('msgstr '):
            value = json.loads(line[7:]); active = 'value'
        elif line.startswith('"'):
            if active == 'key': key += json.loads(line)
            elif active == 'value': value += json.loads(line)
        elif not line and key is not None:
            if key in entries: raise ValueError('Duplicate msgid: ' + key)
            entries[key] = value
            key = value = active = None
    return entries


class TranslationTests(unittest.TestCase):
    def test_all_view_and_menu_keys_have_chinese_translations(self):
        entries = catalog()
        resources = APP / 'htdocs/luci-static/resources'
        files = [resources / 'tailscale/ui.js', *[p for p in (resources / 'view/tailscale').glob('*.js') if not p.is_symlink()]]
        keys = set()
        for file in files:
            source = file.read_text()
            self.assertNotRegex(source, r'[\u4e00-\u9fff]', file.name)
            for text in re.findall(r"_\('((?:\\.|[^'\\])*)'\)", source):
                keys.add(text.replace("\\'", "'").replace('\\n', '\n'))
        menu = json.loads((APP / 'root/usr/share/luci/menu.d/luci-app-tailscale.json').read_text())
        keys.update(entry['title'] for entry in menu.values())
        self.assertGreater(len(keys), 150)
        for key in keys:
            self.assertTrue(entries.get(key), key)

    def test_fixed_backend_errors_have_translations(self):
        entries = catalog()
        helper = (APP / 'root/usr/lib/tailscale-luci.sh').read_text()
        keys = re.findall(r"(?:ts_error |TS_SNAPSHOT_ERROR=)'([^']+)'", helper)
        rpc = (APP / 'root/usr/libexec/rpcd/tailscale').read_text()
        keys += re.findall(r'json_add_string output "([^"$]+)"', rpc)
        self.assertGreater(len(keys), 15)
        for key in keys: self.assertTrue(entries.get(key), key)

    def test_format_parameters_and_running_state(self):
        entries = catalog()
        self.assertEqual(entries['Running'], '运行中')
        self.assertIn('Language: zh_CN\n', entries[''])
        for key, value in entries.items():
            if key:
                self.assertEqual(re.findall(r'%[sd]', key), re.findall(r'%[sd]', value), key)

    def test_packaged_catalog_uses_standard_luci_language_name(self):
        builder = (ROOT / 'packaging/build_run.py').read_text()
        self.assertIn("i18n/'tailscale.zh-cn.lmo'", builder)
        # English is the default source language; no English-only override of LuCI.
        self.assertNotIn('tailscale.en.lmo', builder)
        self.assertIn('tailscale.zh-cn.lmo', (ROOT / 'build-run.sh').read_text())


if __name__ == '__main__': unittest.main()
