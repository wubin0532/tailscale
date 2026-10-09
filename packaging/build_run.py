#!/usr/bin/env python3
"""Assemble an offline .run; only the payload is compressed, never two core copies."""
import gzip, hashlib, io, json, os, shutil, subprocess, tarfile
from pathlib import Path
import dependencies
ROOT=Path(__file__).resolve().parents[1]
ENV=dict(line.strip().split('=',1) for line in (ROOT/'core-version.env').read_text().splitlines() if '=' in line and not line.startswith('#'))

def payload(directory):
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.GNU_FORMAT) as archive:
        for path in sorted(directory.rglob('*')):
            if path.name=='.DS_Store': continue
            entry=archive.gettarinfo(str(path),arcname=path.relative_to(directory).as_posix())
            entry.uid=entry.gid=0;entry.uname=entry.gname='root';entry.mtime=0
            if entry.isdir(): entry.mode=0o755
            with path.open('rb') if entry.isfile() else io.BytesIO() as content: archive.addfile(entry,content if entry.isfile() else None)
    return gzip.compress(stream.getvalue(),compresslevel=9,mtime=0)

def build(arch):
    base=ROOT/'build/run-stage'/arch
    if base.exists(): shutil.rmtree(base)
    data=base/'data'
    shutil.copytree(ROOT/'luci-app-tailscale/root',data,symlinks=True,ignore=shutil.ignore_patterns('.DS_Store'))
    shutil.copytree(ROOT/'luci-app-tailscale/htdocs/luci-static/resources',data/'www/luci-static/resources',symlinks=True,ignore=shutil.ignore_patterns('.DS_Store'))
    runtime=data/'usr/lib/tailscale-luci/runtime'
    dependencies.stage(arch,runtime)
    sbin=data/'usr/sbin';sbin.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'build/combined'/arch/'tailscaled',sbin/'tailscaled');(sbin/'tailscaled').chmod(0o755)
    (sbin/'tailscale').symlink_to('tailscaled')
    i18n=data/'usr/lib/lua/luci/i18n';i18n.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'build/i18n/tailscale.zh-cn.lmo',i18n/'tailscale.zh-cn.lmo')
    meta=data/'usr/share/tailscale-luci';meta.mkdir(parents=True,exist_ok=True)
    licenses=meta/'licenses';licenses.mkdir()
    upstream=ROOT/'build/source'/('tailscale-'+ENV['CORE_VERSION'])
    shutil.copyfile(upstream/'LICENSE',licenses/'tailscale-LICENSE')
    shutil.copyfile(upstream/'licenses/tailscale.md',licenses/'tailscale-third-party.md')
    if (ROOT/'packaging/licenses').exists(): shutil.copytree(ROOT/'packaging/licenses',licenses/'runtime',dirs_exist_ok=True)
    manifest={'plugin':'v2.0','installer_version':ENV['APP_VERSION']+'-r'+ENV['APP_RELEASE'], 'architecture':arch,'core':ENV['CORE_VERSION'],'core_commit':ENV['CORE_SOURCE_COMMIT'],'source_archive_sha256':ENV['CORE_SOURCE_SHA256'],'core_build':'upstream build_dist.sh --box --strip','build_tags':['ts_include_cli'],'features':'full','go':ENV['GO_VERSION'],'upx':ENV['UPX_VERSION'],'project_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'dirty_source':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'core_sha256':hashlib.sha256((sbin/'tailscaled').read_bytes()).hexdigest()}
    (meta/'build.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (meta/'installed-files').write_text('') # replaced with complete file list at install time
    for path in data.rglob('*'):
        if path.is_symlink() or not path.is_file(): continue
        rel=path.relative_to(data).as_posix()
        executable=(rel in ('etc/init.d/tailscale','usr/libexec/rpcd/tailscale','usr/libexec/tailscale-route-watch','usr/sbin/tailscaled','usr/lib/tailscale-luci-uninstall.sh') or rel.startswith('usr/lib/tailscale-luci/runtime/'))
        if not rel.startswith('usr/lib/tailscale-luci/runtime/'): path.chmod(0o755 if executable else 0o644)
    (data/'etc/config/tailscale').chmod(0o600)
    files=[p for p in sorted(data.rglob('*')) if p.is_file() or p.is_symlink()]
    (base/'FILES').write_text(''.join(p.relative_to(data).as_posix()+'\n' for p in files))
    (base/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(data).as_posix()+'\n' for p in files if not p.is_symlink()))
    installer=(ROOT/'packaging/install.sh').read_text().replace('@CORE_VERSION@',ENV['CORE_VERSION'])
    (base/'install.sh').write_text(installer)
    packed=payload(base)
    version=ENV['APP_VERSION']+'-r'+ENV['APP_RELEASE']
    header=(ROOT/'packaging/run-header.sh').read_text().replace('@VERSION@',version).replace('@ARCH@',arch).replace('@SHA256@',hashlib.sha256(packed).hexdigest()).replace('@TEMP_KB@',str((len(packed)+sum(p.stat().st_size for p in files if not p.is_symlink()))//1024+8192))
    output=ROOT/'dist'/f'tailscale-luci_{version}_{arch}.run'
    output.parent.mkdir(exist_ok=True)
    output.write_bytes(header.encode()+packed);output.chmod(0o755)
    print(f'{output.name}: {output.stat().st_size/1000000:.2f} MB')
    return output

if __name__=='__main__':
    files=[build(arch) for arch in os.environ.get('CORE_ARCHES','arm64 arm mipsle amd64').split()]
    (ROOT/'dist/SHA256SUMS-v2.0-run.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in files))
