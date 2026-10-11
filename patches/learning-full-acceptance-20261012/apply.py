#!/usr/bin/env python3
"""Apply only to an isolated copy of the current course release; never deploy."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

BASE = Path(__file__).resolve().parent
LIVE = Path('/opt/omindos-deploy/chat-current')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def safe_path(root, relative):
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ValueError('Path escapes candidate: ' + relative)
    return target

def apply(root, check=False):
    root = root.resolve(strict=True)
    if LIVE.exists() and (root == LIVE.resolve() or root.is_relative_to(LIVE.resolve())):
        raise ValueError('Refusing to modify the active production release. Copy it first.')
    manifest = json.loads((BASE / 'manifest.json').read_text())
    for relative, expected in manifest['runtime'].items():
        data = safe_path(root, relative).read_bytes()
        if digest(data) != expected:
            raise ValueError('Pinned Python runtime differs: ' + relative)
    outputs = []
    # Validate every existing file and final result before any writes.
    for entry in manifest['files']:
        relative = entry['path']
        target = safe_path(root, relative)
        old = target.read_bytes() if target.exists() else None
        current = digest(old) if old is not None else None
        if current == entry['after_sha256']:
            continue
        if current != entry['before_sha256']:
            raise ValueError('Source changed; rebase this patch before applying: ' + relative)
        if entry['kind'] == 'module':
            data = safe_path(BASE / 'modules', relative).read_bytes()
        else:
            text = old.decode('utf-8')
            for edit in reversed(entry['edits']):
                start, end = edit['start'], edit['end']
                if text[start:end] != edit['before']:
                    raise ValueError('Patch context mismatch: ' + relative)
                text = text[:start] + edit['after'] + text[end:]
            data = text.encode('utf-8')
        if digest(data) != entry['after_sha256']:
            raise ValueError('Result hash mismatch: ' + relative)
        outputs.append((target, data))
    if not check:
        for target, data in outputs:
            target.parent.mkdir(parents=True, exist_ok=True)
            mode = target.stat().st_mode & 0o777 if target.exists() else 0o644
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as temporary:
                temporary.write(data)
                temporary_path = Path(temporary.name)
            try:
                temporary_path.chmod(mode)
                os.replace(temporary_path, target)
            finally:
                temporary_path.unlink(missing_ok=True)
    print(('Validated' if check else 'Applied') + f' {len(outputs)} changed file(s); runtime and source hashes verified.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        apply(args.candidate, args.check)
    except (ValueError, OSError) as error:
        parser.exit(1, str(error) + '\n')
