#!/usr/bin/env python3
"""Verify all .run payloads, ELF architecture, single-core layout and dependency closure."""
import gzip, hashlib, io, json, os, re, shutil, struct, subprocess, tarfile, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ENV=dict(line.split('=',1) for line in (ROOT/'core-version.env').read_text().splitlines() if '=' in line)
MACHINE={'arm64':183,'arm':40,'mipsle':8,'amd64':62}
QEMU={'arm64':'qemu-aarch64','arm':'qemu-arm','mipsle':'qemu-mipsel','amd64':'qemu-x86_64'}

def elf(data):
 assert data[:4]==b'\x7fELF','not ELF'
 endian='<' if data[5]==1 else '>'
 return struct.unpack_from(endian+'H',data,18)[0]

def check(path,execute=False):
 header,compressed=path.read_bytes().split(b'__TAILSCALE_PAYLOAD__\n',1)
 expected=re.search(rb"printf '%s  %s\\n' '([a-f0-9]{64})'",header).group(1).decode()
 assert hashlib.sha256(compressed).hexdigest()==expected,path
 arch=next(a for a in MACHINE if path.name.endswith('_'+a+'.run'))
 with tarfile.open(fileobj=io.BytesIO(gzip.decompress(compressed)),mode='r:') as archive:
  members={m.name:m for m in archive.getmembers()}
  for name,m in members.items():
   assert not name.startswith('/') and '..' not in Path(name).parts,name
   assert m.uid==m.gid==0,name
   assert m.isfile() or m.isdir() or m.issym(),name
   if m.issym():
    assert not m.linkname.startswith('/'),name
    # Resolve lexically without allowing links to escape the payload.
    parts=[]
    for part in (Path(name).parent/ m.linkname).parts:
     if part=='..':assert parts;parts.pop()
     elif part!='.':parts.append(part)
    assert parts[0]=='data',name
  assert members['data/usr/sbin/tailscale'].issym()
  assert members['data/usr/sbin/tailscale'].linkname=='tailscaled'
  assert members['data/etc/config/tailscale'].mode==0o600
  assert members['data/usr/sbin/tailscaled'].mode==0o755
  checksums=archive.extractfile('SHA256SUMS').read().decode().splitlines()
  for line in checksums:
   digest,name=line.split('  ',1)
   assert hashlib.sha256(archive.extractfile('data/'+name).read()).hexdigest()==digest,name
  metadata=json.load(archive.extractfile('data/usr/share/tailscale-luci/build.json'))
  assert metadata['core']==ENV['CORE_VERSION']
  assert metadata['core_commit']==ENV['CORE_SOURCE_COMMIT']
  assert metadata['build_tags']==['ts_include_cli']
  for name,m in members.items():
   if m.isfile():
    data=archive.extractfile(m).read()
    if data[:4]==b'\x7fELF':assert elf(data)==MACHINE[arch],name
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory);archive.extractall(target,filter='fully_trusted')
   binary=target/'data/usr/sbin/tailscaled'
   subprocess.run([os.environ.get('UPX_BIN','upx'),'-t',str(binary)],check=True,stdout=subprocess.DEVNULL)
   subprocess.run([os.environ.get('UPX_BIN','upx'),'-d',str(binary)],check=True,stdout=subprocess.DEVNULL)
   build_info=subprocess.check_output(['go','version','-m',str(binary)],text=True)
   assert '-tags=ts_include_cli' in build_info and 'ts_omit_' not in build_info,build_info
   assert 'vcs.revision=' not in build_info,build_info
   assert 'CGO_ENABLED=0' in build_info and 'go'+ENV['GO_VERSION'] in build_info,build_info
   if execute:
    # QEMU cannot reliably execute an UPX self-extractor; check the identical decoded ELF.
    command=[] if arch=='amd64' and os.uname().sysname=='Linux' and os.uname().machine=='x86_64' else [QEMU[arch]]
    env={**os.environ,'TS_BE_CLI':'true'}
    version=subprocess.check_output(command+[str(binary),'version'],env=env,text=True)
    assert version.splitlines()[0]==ENV['CORE_VERSION'],version
    assert ENV['CORE_SOURCE_COMMIT'] in version,version
    for feature in ['netcheck','ping','ssh','file','serve','funnel','set','up','login','logout']:
     result=subprocess.run(command+[str(binary),feature,'--help'],env=env,capture_output=True,text=True)
     assert result.returncode==0,(arch,feature,result.stderr)
    runtime=target/'data/usr/lib/tailscale-luci/runtime'
    loader=next((runtime/'lib').glob('ld-musl-*.so.1'))
    toolchain=command+[str(loader),'--library-path',str(runtime/'lib')+':'+str(runtime/'usr/lib')]
    for tool,arg in [('usr/bin/curl','--version'),('usr/libexec/ip-full','-Version'),('usr/bin/util-linux-flock','--version'),('usr/bin/jshn','-h')]:
     result=subprocess.run(toolchain+[str(runtime/tool),arg],capture_output=True,text=True)
     # jshn -h prints help then exits 2.
     assert result.returncode in ([0,2] if tool.endswith('jshn') else [0]),(arch,tool,result.stderr)
 print(path.name,'verified')

if __name__=='__main__':
 files=[ROOT/'dist'/f'tailscale-luci_{ENV["APP_VERSION"]}-r{ENV["APP_RELEASE"]}_{arch}.run' for arch in os.environ.get('CORE_ARCHES','arm64 arm mipsle amd64').split()]
 for path in files:check(path,'--execute' in os.sys.argv)
 manifest=(ROOT/'dist/SHA256SUMS-v2.0-run.txt').read_text()
 for path in files:assert hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.name in manifest
