#!/usr/bin/env python3
"""Prepare a gateway candidate; never switch or restart production."""
from pathlib import Path
import argparse
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('--current', type=Path, required=True)
parser.add_argument('--candidate', type=Path, required=True)
args = parser.parse_args()
if args.candidate.exists():
    raise SystemExit('Candidate must not already exist')
source = (args.current / 'gateway.mjs').read_text()
anchor = '(?:api|assets|grading'
if source.count(anchor) != 1:
    raise SystemExit('Gateway source changed; inspect the ROOTS pattern first')
source = source.replace(anchor, r'(?:api|assets|subtitles(?:-audio)?(?:\.(?:html|js|css))?|grading', 1)
shutil.copytree(args.current, args.candidate, symlinks=True)
(args.candidate / 'gateway.mjs').write_text(source)
print('Candidate prepared; production unchanged')
