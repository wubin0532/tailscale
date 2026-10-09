#!/usr/bin/env python3
"""Linux/root only: real OpenWrt opkg + upstream iStore dotrun/unrun in a chroot.

Run in a separate network namespace. No router is modified. Framework reloads
are fixture scripts; the package database, UCI and iStore code are unmodified.
"""
import hashlib, json, os, shutil, subprocess, tarfile, tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ROOTFS_URL='https://downloads.openwrt.org/releases/24.10.4/targets/x86/64/openwrt-24.10.4-x86-64-rootfs.tar.gz'
ROOTFS_SHA='e7f8ab84eef55c7eb23492de7b0517dbc23fbedaa4abbb680fe64720c309dc03'
ISTORE_URL='https://raw.githubusercontent.com/linkease/istore/a97ace34f2da358a015b094d326bba2697697f2e/luci/luci-app-store/root/bin/is-opkg'
ISTORE_SHA='6028c5e8c6b3c4224658b5348582096b099b88dffe16a580c6967ec7a634b865'
ENV=dict(line.split('=',1) for line in (ROOT/'core-version.env').read_text().splitlines() if '=' in line)

def download(url,digest,destination):
    subprocess.run(['curl','-fLsS','--retry','2','--max-time','180',url,'-o',str(destination)],check=True)
    assert hashlib.sha256(destination.read_bytes()).hexdigest()==digest,url

def verify():
    assert os.geteuid()==0 and os.uname().sysname=='Linux'
    package=ROOT/'dist'/f'tailscale-luci_{ENV["APP_VERSION"]}-r{ENV["APP_RELEASE"]}_amd64.run'
    with tempfile.TemporaryDirectory(prefix='tailscale-native-') as directory:
        base=Path(directory);router=base/'router';router.mkdir()
        archive=base/'rootfs.tar.gz';download(ROOTFS_URL,ROOTFS_SHA,archive)
        # The exact official archive is trusted only after its pinned SHA check.
        with tarfile.open(archive) as tar:tar.extractall(router,filter='fully_trusted')
        download(ISTORE_URL,ISTORE_SHA,router/'bin/is-opkg');(router/'bin/is-opkg').chmod(0o755)
        for path in ['usr/share/luci','tmp/is-root/tmp','tmp/lock','tmp/run','etc/tailscale','dev/net']:(router/path).mkdir(parents=True,exist_ok=True)
        # Rootfs does not boot in a chroot; preserve real package/UCI executables.
        for path in ['etc/init.d/firewall','etc/init.d/rpcd']:
            p=router/path;p.write_text('#!/bin/sh\nexit 0\n');p.chmod(0o755)
        for path,major,minor in [('dev/null',1,3),('dev/zero',1,5),('dev/random',1,8),('dev/urandom',1,9),('dev/net/tun',10,200)]:
            p=router/path
            if not p.exists():os.mknod(p,0o20666,os.makedev(major,minor))
        def run(*args,success=True):
            # Make the chroot itself a mount point before mounting proc. BusyBox
            # df needs this to resolve /tmp and /usr from /proc/mounts correctly.
            mount_and_run='router=$1; shift; mount --bind "$router" "$router" && mount -t proc proc "$router/proc" && exec chroot "$router" "$@"'
            result=subprocess.run(['unshare','--mount','--pid','--fork','--net','--propagation','private','/bin/sh','-c',mount_and_run,'native-fixture',str(router),*args],text=True,capture_output=True,timeout=150)
            if success:assert result.returncode==0,(args,result.stdout,result.stderr)
            return result
        def installed():return set(run('opkg','list-installed').stdout.splitlines())
        before=installed()
        for round in range(2):
            shutil.copyfile(package,router/'tmp/tailscale-test.run');(router/'tmp/tailscale-test.run').chmod(0o755)
            result=run('/bin/sh','/bin/is-opkg','dotrun','/tmp/tailscale-test.run')
            print(result.stdout)
            assert run('opkg','status','tailscale-luci-run').stdout.count('Status: install user installed')==1
            records=list((router/'usr/share/istore/run-records').glob('*.txt'))
            assert len(records)==1,records
            content=records[0].read_text().splitlines();record=json.loads(content[0])
            assert content[1:]==['tailscale-luci-run']
            if round==0:
                state=router/'etc/tailscale/tailscaled.state';state.write_text('fixture fresh identity\n')
                (router/'etc/config/tailscale').unlink() # reproduces the Home failure
                (router/'usr/lib/tailscale-luci-uninstall.sh').unlink() # self-contained prerm
                result=run('/bin/sh','/bin/is-opkg','unrun',record['id'])
                print(result.stdout)
                assert installed()==before,'shared firmware packages were changed'
                for path in ['usr/sbin/tailscaled','usr/lib/tailscale-luci','etc/tailscale','root/tailscale-backup-v2']:
                    assert not (router/path).exists(),path
                assert not list((router/'usr/share/istore/run-records').glob('*.txt'))
        # Upgrade replaces the record rather than creating duplicates; only
        # --keep-state may retain identity/configuration/recovery archives.
        (router/'etc/tailscale').mkdir(exist_ok=True)
        state=router/'etc/tailscale/tailscaled.state';state.write_text('fixture identity to retain\n')
        shutil.copyfile(package,router/'tmp/tailscale-test.run');(router/'tmp/tailscale-test.run').chmod(0o755)
        run('/bin/sh','/bin/is-opkg','dotrun','/tmp/tailscale-test.run')
        assert len(list((router/'usr/share/istore/run-records').glob('*.txt')))==1
        run('/bin/sh','/usr/lib/tailscale-luci-uninstall.sh','--keep-state')
        assert state.read_text()=='fixture identity to retain\n'
        assert (router/'etc/config/tailscale').exists()
        assert not (router/'usr/sbin/tailscaled').exists()
        assert installed()==before
        print('Native opkg + iStore: install, full removal, missing config/script, reinstall, upgrade and keep-state passed.')

if __name__=='__main__':verify()
