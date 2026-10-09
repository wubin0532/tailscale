#!/usr/bin/env python3
"""Resolve once from official feeds; ordinary builds require the committed lock."""
import argparse, concurrent.futures, gzip, hashlib, io, json, os, re, shutil, subprocess, tarfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RELEASE = '24.10.4'
ARCHES = {'arm64': ('aarch64_cortex-a53', 'qualcommax/ipq807x'), 'arm': ('arm_cortex-a7_neon-vfpv4', 'ipq40xx/generic'), 'mipsle': ('mipsel_24kc', 'ramips/mt7621'), 'amd64': ('x86_64', 'x86/64')}
CACHE = ROOT / 'build/dependencies'
LOCK = ROOT / 'dependencies.lock.json'

def download(url):
    return subprocess.check_output(['curl','-fsSL','--retry','2','--connect-timeout','15','--max-time','180',url])

def resolve(arch):
    owrt, target = ARCHES[arch]
    urls = [f'https://downloads.openwrt.org/releases/{RELEASE}/packages/{owrt}/{feed}/' for feed in ('base','packages')]
    urls.append(f'https://downloads.openwrt.org/releases/{RELEASE}/targets/{target}/packages/')
    index = {}
    for url in urls:
        for block in gzip.decompress(download(url+'Packages.gz')).decode().split('\n\n'):
            fields = dict(line.split(': ',1) for line in block.splitlines() if ': ' in line and not line.startswith(' '))
            if 'Package' in fields:
                fields['download'] = url + fields.get('Filename','')
                index[fields['Package']] = fields
    # Essential libc is distributed but deliberately omitted from Packages.gz.
    listing = download(urls[-1]).decode()
    filename = re.search(r'href="(libc_[^"]+\.ipk)"', listing).group(1)
    data = download(urls[-1]+filename)
    index['libc'] = {'Package':'libc','Version':filename.split('_')[1], 'License':'MIT', 'Depends':'libgcc1', 'download':urls[-1]+filename, 'SHA256sum':hashlib.sha256(data).hexdigest()}
    wanted, pending = {}, ['curl','jsonfilter','jshn','ip-full','flock','ca-bundle']
    while pending:
        name = pending.pop()
        if name in wanted: continue
        fields = index[name]
        wanted[name] = {k: fields.get(k,'') for k in ('Package','Version','License','download','SHA256sum')}
        for dependency in fields.get('Depends','').split(','):
            dependency = dependency.strip().split(' ')[0]
            if dependency: pending.append(dependency)
    return list(sorted(wanted.values(), key=lambda f:f['Package']))

def contents(data):
    # OpenWrt IPKs are tar containers, not Debian ar archives.
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:*') as outer:
        member = next(m for m in outer.getmembers() if m.name.lstrip('./')=='data.tar.gz')
        return outer.extractfile(member).read()

def stage(arch, destination):
    lock = json.loads(LOCK.read_text())['architectures'][arch]
    destination.mkdir(parents=True,exist_ok=True)
    for item in lock:
        path = CACHE / arch / Path(item['download']).name
        path.parent.mkdir(parents=True,exist_ok=True)
        if not path.exists(): path.write_bytes(download(item['download']))
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest()!=item['SHA256sum']: raise ValueError('Dependency checksum: '+str(path))
        with tarfile.open(fileobj=io.BytesIO(contents(data)), mode='r:gz') as archive:
            # Keep all runtime files in a private prefix; never install package scripts.
            members = []
            for member in archive.getmembers():
                name = member.name.lstrip('./')
                if not name or member.isdir(): continue
                if '..' in Path(name).parts or name.startswith('/') or not (member.isfile() or member.issym()): raise ValueError(name)
                if member.issym() and member.linkname.startswith('/'): member.linkname = os.path.relpath(destination / member.linkname.lstrip('/'), (destination / name).parent)
                if member.issym() and not (destination / name).parent.joinpath(member.linkname).resolve().is_relative_to(destination.resolve()): raise ValueError('unsafe symlink')
                member.name=name
                members.append(member)
            archive.extractall(destination,members=members,filter='fully_trusted')
    bindir = destination/'bin'; bindir.mkdir(exist_ok=True)
    mapping={'curl':'usr/bin/curl','jsonfilter':'usr/bin/jsonfilter','jshn':'usr/bin/jshn','ip':'usr/libexec/ip-full','flock':'usr/bin/util-linux-flock'}
    loader=next((destination/'lib').glob('ld-musl-*.so.1')).name
    for name, target in mapping.items():
        # Wrappers invoke the bundled loader explicitly; firmware libc is untouched.
        wrapper=bindir/name
        wrapper.write_text('#!/bin/sh\nR=/usr/lib/tailscale-luci/runtime\nexport SSL_CERT_FILE="$R/etc/ssl/certs/ca-certificates.crt"\nexec "$R/lib/'+loader+'" --library-path "$R/lib:$R/usr/lib" "$R/'+target+'" "$@"\n')
        wrapper.chmod(0o755)
    (destination/'PACKAGES.json').write_text(json.dumps(lock,indent=2)+'\n')
    recipes = json.loads(LOCK.read_text()).get('source_recipes', {})
    (destination/'SOURCES.txt').write_text('Unmodified OpenWrt '+RELEASE+' userspace packages. Exact source recipes (including upstream source archive URLs, hashes, patches and build rules):\n'+'\n'.join(k+': '+v for k,v in recipes.items())+'\nSource archive mirror: https://sources.openwrt.org/\nSee PACKAGES.json for exact package versions, licenses, binary URLs and checksums.\n')


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--resolve',action='store_true');p.add_argument('--arch',choices=ARCHES);p.add_argument('--stage',type=Path);a=p.parse_args()
    if a.resolve:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(resolve,ARCHES))
        recipes=json.loads(LOCK.read_text()).get('source_recipes',{}) if LOCK.exists() else {}
        LOCK.write_text(json.dumps({'openwrt':RELEASE,'architectures':dict(zip(ARCHES,results)),'source_recipes':recipes},indent=2)+'\n')
    else: stage(a.arch,a.stage)
