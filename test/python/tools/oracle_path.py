"""Locate the shared harness. The suite CONSUMES it and never reimplements a tier.

The harness lives OUTSIDE this repo on purpose (see `lock.py`): the repo must be
able to detect drift in the frozen expectations and must not be able to authorise
it. If it were vendored here, the quickest way past a red check would be to edit
the answer.
"""
import os
import sys

DEFAULT = '/Users/swapnilpaliwal/Documents/AxiomCode/callchain-oracle/python'


def harness_root() -> str:
    root = os.environ.get('AXIOM_PY_ORACLE', DEFAULT)
    if not os.path.isdir(os.path.join(root, 'callchain_oracle')):
        sys.stderr.write(
            f'callchain-oracle harness not found at {root}\n'
            f'set AXIOM_PY_ORACLE to the checkout of AxiomCode/callchain-oracle/python\n')
        raise SystemExit(77)
    if root not in sys.path:
        sys.path.insert(0, root)
    return root


def locks_dir() -> str:
    return os.path.join(harness_root(), 'locks')
