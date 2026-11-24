"""Shared, verified Android payload history for the phone and desktop helpers."""
import hashlib
import json
from pathlib import Path
from project_paths import publish_directory

ROOT = Path(__file__).resolve().parents[1]
BASELINES = {
    '01ee8b4332fdb024fd4c5b9bfdb38ce25f9d42e0b07941765bc7cd06efdaaaa4': {
        'resourceVersion': '026',
        'bundleRelativePath': 'com.unity.addressables/AssetBundles/4da1f23c112208b0f8df2a1327b4e4ce/3c7700aa58877b365d45231b1225fcbb/__data',
    },
    '2ea82144e02b301a07a236a42706611df82a83b85a92c1b1fdd0d7a1e93a91e2': {
        'resourceVersion': '150',
        'bundleRelativePath': 'com.unity.addressables/AssetBundles/4da1f23c112208b0f8df2a1327b4e4ce/7a5e751e708c075b7272acfd3dbe1249/__data',
    },
    '77da946bf7d331351a93ff16707aab426f534b7577a771f21267478b7bc70c87': {
        'resourceVersion': '152',
        'bundleRelativePath': 'com.unity.addressables/AssetBundles/4da1f23c112208b0f8df2a1327b4e4ce/0c6650c5e9eccffde61b8397d4694f72/__data',
    },
    '10da88362ca670dacdafd9f994b62711f1503bff9c6c26a0aa958e165ab5dc5a': {
        'resourceVersion': '160',
        'bundleRelativePath': 'com.unity.addressables/AssetBundles/4da1f23c112208b0f8df2a1327b4e4ce/f34d1f473cc7580b5d29def0211599a4/__data',
    },
}


def verified_baseline(original_sha):
    baseline = BASELINES.get(original_sha)
    if baseline is None:
        raise ValueError('Unknown Android baseline; verify version and compatibility before patching')
    return baseline


def validate_baseline_manifest(manifest):
    baseline = verified_baseline(manifest['originalSha256'])
    if (manifest['bundleRelativePath'] != baseline['bundleRelativePath']
            or manifest.get('resourceVersion', baseline['resourceVersion']) != baseline['resourceVersion']):
        raise ValueError('Android resource path/version does not match its verified baseline')
    return baseline


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def previous_hashes(manifest, additional_manifests=()):
    # Only intact candidates for this exact game/resource build are accepted.
    validate_baseline_manifest(manifest)
    found = set()
    if manifest['originalSha256'] == '01ee8b4332fdb024fd4c5b9bfdb38ce25f9d42e0b07941765bc7cd06efdaaaa4':
        found.add('3d94697f4dc6d64c2cb5fcca56339090f54e920cd7dab6de7bcc1912347e5a0f')
    if manifest['originalSha256'] == '10da88362ca670dacdafd9f994b62711f1503bff9c6c26a0aa958e165ab5dc5a':
        found.add('fac55f465672d693fe34315601e25e3dbc1f621bc0b97903c1790e63eb3398b0')
        found.add('a4c53f8afd9e8d3cd2ffb49b7b714d466af0f5b8fe677ffdb647fbdd6d3158a7')
        found.add('6636dc60b85ebda6096bdc1a52922e455598574a20ca69f537c459d306e657d5')
        found.add('80ffa6b0cfb025ddbfa8d16b76770e3998140d266ba9b0650089746c64bf7d92')
        found.add('bae736483576fcb7d27039cf80c494faf2b919523e7a208ae32f8f35de6f4744')
        found.add('c495d9bfaf053d3f730a5f352217624db53f4d790d86c2b76ad3820f67826952')
        found.add('ea3eb8324b3eba43b383346a7ef7f565d579a4f29c3701b197cc2129c6418f9a')
        found.add('49082db287af3659707b3b75022d9e5a865793c26dfd35e20d92e451aa32fc24')
        found.add('9da1b62b7a05e00efca9f0df6640a61fa9cd09045da147f50dd56b17a09d6d32')
        found.add('e3794b50ec7c95b5c42b07ff35ad0d10d7c16e9ba047e56d9618e11097a52c7c')
        found.add('e597a28529990a646016baaaf45aa963143885996cc38817c38b7c529cbf0b7e')
        found.add('f677f589146137b57c0baee8bc2ad30600cfafd814ceb7bc43491783db6d82a2')
        found.add('1be43212a0b1e1b44c1b937e1112862634840bf013bbb4368aa6340c61b025a5')
    releases = publish_directory(ROOT)
    manifests = set(releases.glob('XingShu_Android_*/candidate.json'))
    manifests.update(releases.glob('XingShu_*/Android/candidate.json'))
    # Local hotfixes need the same verified upgrade path before they are packaged.
    explicit = {Path(path).resolve() for path in additional_manifests}
    manifests.update(explicit)
    for path in sorted(manifests):
        old = json.loads(path.read_text(encoding='utf-8-sig'))
        if any(old.get(key) != manifest.get(key) for key in ('platform', 'package', 'appVersion', 'originalSha256', 'bundleRelativePath')):
            if path in explicit:
                raise ValueError('Explicit previous Android manifest belongs to a different game baseline')
            continue
        payload = (path.parent / old['candidate']).resolve()
        if path.parent.resolve() not in payload.parents:
            raise ValueError('Previous Android payload escapes its package')
        if payload.is_file() and sha(payload) == old['candidateSha256']:
            found.add(old['candidateSha256'])
        elif path in explicit:
            raise ValueError('Explicit previous Android payload is missing or corrupt')
    return sorted(found - {manifest['candidateSha256'], manifest['originalSha256']})
