"""Generate standalone remote core-manifest.json for decoupled XingShu Runtime hot-updates."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RELEASE = ROOT / "AstralParty-Hub/src-tauri/src/launcher_component_release.json"
DEFAULT_MEDIA = ROOT / "AstralParty-Hub/src-tauri/src/launcher_media.json"
DEFAULT_INVENTORY = ROOT / "AstralParty-Hub/src-tauri/src/runtime_inventory.generated.json"
DEFAULT_MODULES = ROOT / "AstralParty-Hub/src/shared/launcherModules.json"
DEFAULT_OUT = ROOT / "XingShu-Dev/build/pc-r841/core-manifest.json"

ALLOWED_PLATFORMS = ("STEAM_CN", "TAPTAP", "BILIBILI", "WEGAME")
SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
MODULE_ID_RE = re.compile(r"^[a-z0-9-]{2,64}$")


def validate_manifest_payload(bundle: dict) -> None:
    if bundle.get("formatVersion") != 1:
        raise ValueError("core-manifest formatVersion must be 1")
    rt_ver = str(bundle.get("runtimeVersion") or "").strip()
    if not rt_ver or len(rt_ver) > 64:
        raise ValueError("Invalid runtimeVersion")
    path_prefix = str(bundle.get("pathPrefix") or "")
    if not path_prefix.startswith("/xingshu-hub/assets/launcher-runtime/") or ".." in path_prefix or "//" in path_prefix:
        raise ValueError(f"Invalid pathPrefix: {path_prefix!r}")
    payload_sizes = bundle.get("payloadSizes") or {}
    release = bundle.get("release") or {}
    if release.get("RuntimeVersion") != rt_ver:
        raise ValueError("release.RuntimeVersion mismatch")
    platforms = release.get("Platforms") or []
    if not platforms:
        raise ValueError("release.Platforms must not be empty")
    seen_ids = set()
    for plat in platforms:
        pid = str(plat.get("Id") or "")
        if pid not in ALLOWED_PLATFORMS or pid in seen_ids:
            raise ValueError(f"Invalid or duplicate platform Id: {pid!r}")
        seen_ids.add(pid)
        if plat.get("Payload") != f"Runtime/{pid}/__data":
            raise ValueError(f"{pid}: unexpected Payload path {plat.get('Payload')!r}")
        for key in ("PayloadSha256", "GameAssemblySha256"):
            if not SHA256_RE.match(str(plat.get(key) or "")):
                raise ValueError(f"{pid}: invalid {key}")
        if plat.get("VanillaSha256") and not SHA256_RE.match(str(plat["VanillaSha256"])):
            raise ValueError(f"{pid}: invalid VanillaSha256")
        if not plat.get("AcceptedHashes") or not all(SHA256_RE.match(str(h)) for h in plat["AcceptedHashes"]):
            raise ValueError(f"{pid}: invalid AcceptedHashes")
        size = int(payload_sizes.get(pid) or 0)
        if size <= 0 or size > 64 * 1024 * 1024:
            raise ValueError(f"{pid}: invalid payloadSize {size}")

    official_modules = bundle.get("officialModules") or []
    seen_mod_ids = set()
    for mod in official_modules:
        mod_id = str(mod.get("id") or "").strip()
        mod_name = str(mod.get("name") or "").strip()
        if not MODULE_ID_RE.match(mod_id) or mod_id in seen_mod_ids:
            raise ValueError(f"Invalid or duplicate official module id: {mod_id!r}")
        if not mod_name:
            raise ValueError(f"Official module {mod_id!r} missing name")
        seen_mod_ids.add(mod_id)


def build_core_manifest(
    release_path: Path,
    media_path: Path,
    inventory_path: Path,
    modules_path: Path = DEFAULT_MODULES,
) -> dict:
    release = json.loads(release_path.read_text(encoding="utf-8-sig"))
    media = json.loads(media_path.read_text(encoding="utf-8-sig"))
    inventory = json.loads(inventory_path.read_text(encoding="utf-8-sig"))
    raw_modules = json.loads(modules_path.read_text(encoding="utf-8-sig")) if modules_path.is_file() else []
    official_modules = [
        {
            "id": str(mod["id"]).strip(),
            "name": str(mod["name"]).strip(),
            "description": str(mod.get("description") or "").strip(),
        }
        for mod in raw_modules
    ]
    bundle = {
        "formatVersion": 1,
        "runtimeVersion": release["RuntimeVersion"],
        "pathPrefix": str(media["pathPrefix"]).rstrip("/"),
        "payloadSizes": media["payloadSizes"],
        "release": release,
        "inventory": inventory,
        "officialModules": official_modules,
    }
    validate_manifest_payload(bundle)
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--media", type=Path, default=DEFAULT_MEDIA)
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--modules", type=Path, default=DEFAULT_MODULES)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    bundle = build_core_manifest(args.release, args.media, args.inventory, args.modules)
    encoded = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(encoded, encoding="utf-8")
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    print(f"Wrote {args.out} ({len(encoded.encode('utf-8'))} B, sha256={digest}, runtime={bundle['runtimeVersion']})")


if __name__ == "__main__":
    main()
