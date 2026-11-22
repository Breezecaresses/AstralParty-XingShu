"""Package the optional first-party runtime features for the Windows launcher."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

CATALOG = Path(__file__).resolve().parents[1] / 'AstralParty-Hub/src/shared/launcherModules.json'
PLATFORMS = ['STEAM_CN', 'TAPTAP', 'BILIBILI', 'WEGAME']


def package_mods(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    modules = json.loads(CATALOG.read_text(encoding='utf-8'))
    for module in modules:
        module_id = module['id']
        package_id = f'xingshu.launcher.{module_id}'
        content = f'xingshu-module-v1:{module_id}\n'.encode('utf-8')
        manifest = {
            'schemaVersion': 1,
            'package': {'id': package_id, 'type': 'mod', 'name': module['name'],
                        'version': '1.0.0', 'publisher': '星枢', 'description': module['description']},
            'compatibility': {'game': {'appId': '2622000', 'platforms': PLATFORMS}},
            'install': {'requiresGameClosed': True, 'requiresXingShuClosed': False, 'backup': True},
            'files': [{'source': 'payload/feature.module', 'target': f'xingshu/plugins/{package_id}.module',
                       'sha256': hashlib.sha256(content).hexdigest(), 'size': len(content)}],
        }
        with zipfile.ZipFile(destination / f'{module_id}.xspkg', 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
            archive.writestr('payload/feature.module', content)
    print(f'Packaged {len(modules)} optional modules', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    package_mods(parser.parse_args().destination)
