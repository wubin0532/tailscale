#!/usr/bin/env python3
"""Read compiled catalogs with upstream LuCI's real LMO implementation."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from test_i18n import catalog, ROOT

source = Path(sys.argv[1]).resolve()  # upstream modules/luci-base/src
assert (source / 'lib/lmo.o').exists() and (source / 'lib/plural_formula.o').exists()
entries = {key: value for key, value in catalog().items() if key}
with tempfile.TemporaryDirectory(prefix='tailscale-i18n-') as directory:
    base = Path(directory)
    code = base / 'reader.c'
    code.write_text(r'''
#include "lib/lmo.h"
int main(int argc, char **argv) {
    char *key = NULL, *translated = NULL;
    size_t capacity = 0;
    ssize_t len;
    int translated_len;
    if (argc != 3) return 2;
    lmo_load_catalog(argv[1], argv[2]);
    lmo_change_catalog(argv[1]);
    while ((len = getline(&key, &capacity, stdin)) >= 0) {
        if (len && key[len - 1] == '\n') key[--len] = 0;
        if (!lmo_translate(key, len, &translated, &translated_len))
            printf("%.*s\n", translated_len, translated);
        else printf("%s\n", key);
    }
    free(key);
    return 0;
}
''')
    binary = base / 'reader'
    subprocess.run([os.environ.get('CC', 'cc'), '-I', str(source), str(code), str(source / 'lib/lmo.o'), str(source / 'lib/plural_formula.o'), '-o', str(binary)], check=True)
    keys = list(entries)
    for language, expected in [('zh-cn', list(entries.values())), ('en', keys), ('fr', keys)]:
        result = subprocess.run([str(binary), language, str(ROOT / 'build/i18n')], input='\n'.join(keys) + '\n', capture_output=True, text=True, check=True)
        actual = result.stdout.splitlines()
        assert actual == expected, (language, [(key, got, wanted) for key, got, wanted in zip(keys, actual, expected) if got != wanted][:8], len(actual), len(expected))
        print(f'{language}: {len(keys)} compiled catalog translations/fallbacks verified by upstream LuCI')
