#!/usr/bin/env python3
import io, tarfile, hashlib, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
arches={'aarch64_cortex-a53':'arm64','arm_cortex-a7':'arm','mipsel_24kc':'mipsle','x86_64':'amd64'}
for arch,core in arches.items():
 path=root/'dist'/f'tailscale-luci_2.0.0-1_{arch}.ipk'
 with tarfile.open(path) as outer:
  data=outer.extractfile('./data.tar.gz').read()
  ctrl=outer.extractfile('./control.tar.gz').read()
 with tarfile.open(fileobj=io.BytesIO(ctrl)) as control:
  info=control.extractfile('./control').read().decode()
  assert 'Version: 2.0.0-1\n' in info and 'flock' in info
 with tarfile.open(fileobj=io.BytesIO(data)) as package:
  for binary in ['tailscale','tailscaled']:
   m=package.getmember('./usr/sbin/'+binary)
   assert m.mode==0o755 and m.uid==0 and m.gid==0
   content=package.extractfile(m).read()
   expected=(root/'build'/'packed'/core/binary).read_bytes()
   assert content==expected and b'UPX!' in content
  assert package.getmember('./etc/config/tailscale').mode==0o600
  assert package.extractfile('./usr/share/tailscale-luci/core-version').read().strip()==b'1.104.1'
 print(f'PASS {path.name}: compressed binaries, root ownership, modes and version')
