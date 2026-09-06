#!/usr/bin/env python3
"""Build credential-free desktop ZIPs; Python is build tooling, never required by users.

macOS uses the unmodified official runtime, not a foreign-platform SEA blob.
Runtime archives are pinned by published Node SHA256 and never extracted wholesale.
"""
import argparse
import hashlib
import json
from pathlib import Path
import stat
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MAC_HASHES = {
    'arm64': '25495ff85bd89e2d8a24d88566d7e2f827c6b0d3d872b2cebf75371f93fcb1fe',
    'x64': '2526230ad7d922be82d4fdb1e7ee1e84303e133e3b4b0ec4c2897ab31de0253d',
}


def source_files():
    files = [ROOT / 'server.mjs', ROOT / 'package.json']
    for directory in ['src', 'public', 'featurescript']:
        for path in sorted((ROOT / directory).rglob('*')):
            if path.is_symlink():
                raise ValueError(f'Refusing linked build input: {path}')
            if path.is_file():
                if any(part.startswith('.') for part in path.relative_to(ROOT).parts):
                    raise ValueError(f'Refusing hidden build input: {path}')
                if path.suffix not in {'.mjs', '.js', '.css', '.html', '.svg', '.png', '.fs'}:
                    raise ValueError(f'Unexpected build input: {path}')
                files.append(path)
    return files


def put(archive, name, data, executable=False):
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-downloads', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    version = json.loads((ROOT / 'package.json').read_text())['version']
    args.output.mkdir(parents=True, exist_ok=True)
    guide = (ROOT / 'docs/START-HERE.html').read_bytes()
    license_data = (ROOT / 'LICENSE').read_bytes()
    runtimes = {}
    for arch, expected in MAC_HASHES.items():
        prefix = f'node-v24.14.1-darwin-{arch}'
        path = args.runtime_downloads / f'{prefix}.tar.gz'
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Runtime checksum mismatch: {path.name}')
        with tarfile.open(path, 'r:gz') as tar:
            runtime = tar.extractfile(f'{prefix}/bin/node').read()
            node_license = tar.extractfile(f'{prefix}/LICENSE').read()
        # Require the native Mach-O header and the architecture advertised.
        cpu = int.from_bytes(runtime[4:8], 'little')
        if runtime[:4] != b'\xcf\xfa\xed\xfe' or cpu != {'arm64': 0x100000c, 'x64': 0x1000007}[arch]:
            raise ValueError(f'Unexpected Mach-O architecture: {arch}')
        runtimes[arch] = (runtime, node_license)
    outputs = []
    for platform in ['windows-x64', 'linux-x64', 'macos-arm64', 'macos-x64']:
        destination = args.output / f'reference-align-{version}-{platform}.zip'
        # Never silently replace an already shared release.
        with zipfile.ZipFile(destination, 'x') as archive:
            put(archive, 'START-HERE.html', guide)
            put(archive, 'LICENSE.txt', license_data)
            if platform.startswith('macos-'):
                runtime, node_license = runtimes[platform.split('-')[1]]
                put(archive, 'runtime/node', runtime, True)
                put(archive, 'NODE-LICENSE.txt', node_license)
                put(archive, 'START-REFERENCE-ALIGN.command', (ROOT / 'scripts/START-REFERENCE-ALIGN.command').read_bytes(), True)
                for source in source_files():
                    put(archive, f'app/{source.relative_to(ROOT).as_posix()}', source.read_bytes())
            else:
                windows = platform.startswith('windows')
                binary = 'reference-align.exe' if windows else 'reference-align'
                suffix = 'cmd' if windows else 'sh'
                put(archive, binary, (ROOT / 'dist' / platform / binary).read_bytes(), True)
                launcher = (ROOT / f'scripts/START-REFERENCE-ALIGN.{suffix}').read_bytes()
                if windows:
                    launcher = launcher.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
                put(archive, f'START-REFERENCE-ALIGN.{suffix}', launcher, True)
                node_license = runtimes['arm64'][1] if windows else (args.runtime_downloads / 'NODE-LICENSE-24.15.0.txt').read_bytes()
                put(archive, 'NODE-LICENSE.txt', node_license)
        with zipfile.ZipFile(destination) as archive:
            if archive.testzip() is not None:
                raise ValueError(f'Archive integrity failure: {destination}')
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        outputs.append(f'{digest}  {destination.name}\n')
        print(f'{destination.name}: {destination.stat().st_size} bytes; SHA256 {digest}')
    (args.output / 'SHA256SUMS').write_text(''.join(outputs))


if __name__ == '__main__':
    main()
