#!/usr/bin/env python3
"""Fail if the vendored harness modules have drifted from the real harness.

tools/vendor/ holds copies of the two callchain-oracle modules the ENGINE side needs, so
the suite runs in a bare clone (see tools/vendor/__init__.py). Copying re-introduces the
drift risk the harness deliberately avoided by having the engine import it.

This restores the guarantee wherever it can be checked: on any machine that HAS the
harness, the copies must be byte-identical to it. A machine without the harness cannot
check, and does not pretend to — it skips.

usage: check_vendor.py            exit 0 identical / skipped, 1 drifted
"""
import os, sys, filecmp

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, 'vendor')
MODULES = ['normalize.py', 'tier1_sites.py']

root = os.environ.get('AXIOM_PY_ORACLE',
                      os.path.join(HERE, '..', '..', '..', '..', 'callchain-oracle', 'python'))
pkg = os.path.join(root, 'callchain_oracle')
if not os.path.isdir(pkg):
    print(f'skip: no harness at {root} — cannot check vendored copies for drift')
    sys.exit(0)

drifted = [m for m in MODULES
           if not filecmp.cmp(os.path.join(pkg, m), os.path.join(VENDOR, m), shallow=False)]
if drifted:
    print('VENDOR DRIFT — the engine side and the oracle would disagree about call-site identity:')
    for m in drifted:
        print(f'    {m}  (harness {pkg}/{m}  vs  vendored {VENDOR}/{m})')
    print('  re-copy those files into tools/vendor/ and re-bless if the goldens move.')
    sys.exit(1)
print(f'vendored copies match the harness at {root} ({", ".join(MODULES)})')
