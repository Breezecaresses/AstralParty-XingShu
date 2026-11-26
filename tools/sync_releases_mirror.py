#!/usr/bin/env python3
"""Sync Desktop & Android release artifacts and latest.json to the official self-hosted domestic mirror."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import posixpath
import re
import ssl
import subprocess
import time
import urllib.request

DEFAULT_HOST = "124.221.176.134"
DEFAULT_USER = "root"
DEFAULT_DOMAIN = "https://astralparty-xingshu.lanxichaxu.cn"
DEFAULT_MEDIA_ROOT = "/var/www/xingshu-launcher-media"


def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def run_ssh(ssh, cmd: str) -> str:
    _, out, err = ssh.exec_command(cmd)
    rc = out.channel.recv_exit_status()
    o = out.read().decode("utf-8", "replace")
    e = err.read().decode("utf-8", "replace")
    if rc != 0:
        raise RuntimeError(f"SSH command failed ({rc}): {cmd}\n{o}\n{e}")
    return o.strip()


def upload_atomic(ssh, sftp, local_path: pathlib.Path, remote_path: str) -> None:
    expected_sha = sha256_file(local_path)
    remote_dir = posixpath.dirname(remote_path)
    tmp_path = f"{remote_path}.tmp.{int(time.time())}"
    run_ssh(ssh, f"mkdir -p '{remote_dir}'")
    sftp.put(str(local_path), tmp_path)
    got_sha = run_ssh(ssh, f"sha256sum '{tmp_path}' | cut -d' ' -f1")
    if got_sha != expected_sha:
        raise RuntimeError(f"Remote SHA-256 mismatch for {remote_path}: {got_sha} != {expected_sha}")
    run_ssh(ssh, f"chown root:root '{tmp_path}' && chmod 0644 '{tmp_path}' && mv -f '{tmp_path}' '{remote_path}'")
    print(f"[SYNCED] {remote_path} ({local_path.stat().st_size:,} B)")


def warm_url(url: str, expected_size: int) -> None:
    for phase in ("WARM", "HIT-CHECK"):
        res = subprocess.run(
            ["curl.exe", "-sS", "-D", "-", "-o", "NUL", "--max-time", "90",
             "-w", "\nSTATS code=%{http_code} size=%{size_download} speed=%{speed_download}", url],
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
        )
        m = re.search(r"STATS code=(\d+) size=(\d+) speed=([\d.]+)", res.stdout)
        assert m and int(m.group(1)) == 200 and int(m.group(2)) == expected_size, f"Warm failed for {url}: {res.stdout}"
        mb_s = float(m.group(3)) / (1024.0 * 1024.0)
        print(f"[{phase}] {url.rsplit('/', 1)[-1]} -> {mb_s:.2f} MB/s")


def main() -> None:
    import paramiko

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=pathlib.Path, required=True, help="Directory holding release binaries and manifests")
    parser.add_argument("--desktop-tag", help="Desktop tag to sync (e.g. v0.2.0)")
    parser.add_argument("--android-tag", help="Android tag to sync (e.g. v0.2.2)")
    parser.add_argument("--prerelease", action="store_true", help="Mark latest.json entries as prerelease")
    parser.add_argument("--host", default=os.environ.get("XINGSHU_MIRROR_HOST", DEFAULT_HOST))
    parser.add_argument("--user", default=os.environ.get("XINGSHU_MIRROR_USER", DEFAULT_USER))
    parser.add_argument("--media-root", default=DEFAULT_MEDIA_ROOT)
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    parser.add_argument("--warm-cdn", action="store_true", help="Warm EdgeOne CDN after uploading")
    args = parser.parse_args()

    if not args.desktop_tag and not args.android_tag:
        parser.error("Provide --desktop-tag and/or --android-tag")

    ssh_password = os.environ.get("XINGSHU_SSH_PASSWORD", "")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs: dict = {"hostname": args.host, "username": args.user, "timeout": 20}
    if ssh_password:
        connect_kwargs.update({"password": ssh_password, "look_for_keys": False, "allow_agent": False})
    ssh.connect(**connect_kwargs)

    warm_targets: list[tuple[str, int]] = []
    staging_files: list[pathlib.Path] = []
    try:
        sftp = ssh.open_sftp()
        try:
            if args.desktop_tag:
                ver = args.desktop_tag.lstrip("v")
                files = [
                    args.release_dir / f"XingShu_Hub_{ver}_x64-setup.exe",
                    args.release_dir / f"XingShu_Hub_{ver}_x64-setup.exe.sha256",
                    args.release_dir / f"XingShu_Desktop_{ver}.zip",
                    args.release_dir / f"XingShu_Desktop_{ver}.zip.sha256",
                ]
                upd = args.release_dir / "xingshu-update.json"
                upd_sha = args.release_dir / "xingshu-update.json.sha256"
                for fp in (*files, upd):
                    assert fp.is_file(), f"Missing desktop file: {fp}"
                    upload_atomic(ssh, sftp, fp, f"{args.media_root}/desktop-releases/{args.desktop_tag}/{fp.name}")
                    if fp.suffix in (".exe", ".zip"):
                        warm_targets.append((f"{args.domain}/xingshu-hub/assets/launcher-runtime/desktop-releases/{args.desktop_tag}/{fp.name}", fp.stat().st_size))
                if upd_sha.is_file():
                    upload_atomic(ssh, sftp, upd_sha, f"{args.media_root}/desktop-releases/{args.desktop_tag}/{upd_sha.name}")
                latest = args.release_dir / ".desktop-latest.tmp.json"
                staging_files.append(latest)
                latest.write_text(
                    json.dumps({"tag": args.desktop_tag, "prerelease": args.prerelease, "envelope": json.loads(upd.read_text("utf-8"))}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                upload_atomic(ssh, sftp, latest, f"{args.media_root}/desktop-releases/latest.json")

            if args.android_tag:
                ver = args.android_tag.lstrip("v")
                files = [
                    args.release_dir / f"XingShu_Android_{ver}.apk",
                    args.release_dir / f"XingShu_Android_{ver}.apk.sha256",
                    args.release_dir / f"XingShu_Android_{ver}.zip",
                    args.release_dir / f"XingShu_Android_{ver}.zip.sha256",
                ]
                upd = args.release_dir / "xingshu-android-update.json"
                assert upd.is_file(), f"Missing android manifest: {upd}"
                for fp in files:
                    assert fp.is_file(), f"Missing android file: {fp}"
                    upload_atomic(ssh, sftp, fp, f"{args.media_root}/android-releases/{args.android_tag}/{fp.name}")
                    if fp.suffix in (".apk", ".zip"):
                        warm_targets.append((f"{args.domain}/xingshu-hub/assets/launcher-runtime/android-releases/{args.android_tag}/{fp.name}", fp.stat().st_size))
                upload_atomic(ssh, sftp, upd, f"{args.media_root}/android-releases/{args.android_tag}/xingshu-update.json")
                latest = args.release_dir / ".android-latest.tmp.json"
                staging_files.append(latest)
                latest.write_text(
                    json.dumps({"tag": args.android_tag, "prerelease": args.prerelease, "envelope": json.loads(upd.read_text("utf-8"))}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                upload_atomic(ssh, sftp, latest, f"{args.media_root}/android-releases/latest.json")
        finally:
            sftp.close()
    finally:
        ssh.close()
        for st in staging_files:
            st.unlink(missing_ok=True)

    ctx = ssl.create_default_context()
    for channel, expected_tag in ([("desktop-releases", args.desktop_tag)] if args.desktop_tag else []) + ([("android-releases", args.android_tag)] if args.android_tag else []):
        url = f"{args.domain}/xingshu-hub/assets/launcher-runtime/{channel}/latest.json?t={int(time.time())}"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-cache"}), timeout=20, context=ctx) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            assert data.get("tag") == expected_tag, f"Unexpected latest tag on {channel}: {data}"
            print(f"[VERIFIED] {channel}/latest.json -> {data['tag']}")

    if args.warm_cdn:
        for url, sz in warm_targets:
            warm_url(url, sz)


if __name__ == "__main__":
    main()
