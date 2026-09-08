#!/usr/bin/env python3
"""THE `const f: FnType = (...) => ...` IDIOM MUST NOT SCORE AS A WRONG ANSWER.

When the compiler names a BODILESS signature and the engine names the implementation of
it, `score.py` credits the engine — its answer is the code that actually runs, and the
signature is a type-level assertion about it. That credit was gated on the two
declarations sharing a NAME and a FILE, so it could only ever fire for the shape that
motivated it (an interface `push` against an OBJECT_LITERAL_METHOD `push` in the same
file) and could NEVER fire for a function-type annotation, where:

  * the names differ BY CONSTRUCTION — the IR calls the annotation's signature `_` or
    `<function-type>` and the arrow implementing it `<arrow>`;
  * the implementation legitimately lives in a DIFFERENT file from the signature, so the
    same-file rule is wrong here rather than merely unhelpful.

Measured before the fix: 9 of 10 remaining WRONG verdicts on the development set were
this one shape, and the report's counter for the bucket printed 0 on every project —
which is the symptom that should have given it away. #237.

THE GATE IS TIED TO THE CALL, not to the shape. The engine's target must be the function
value bound to a variable OF THE NAME BEING CALLED, and that variable must carry a type
annotation. Both halves are controls below, because a credit that can be earned without
them would let an unrelated declaration answer for a signature — which manufactures
agreement instead of measuring it.

SYNTHESISED INPUTS — no parser, solver, compiler or work directory, so it cannot skip.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.normpath(os.path.join(HERE, '..', 'ground-truth', 'score.py'))

checks = 0
failures = []


def ok(msg):
    global checks
    checks += 1
    if os.environ.get('IMPL_CREDIT_VERBOSE'):
        print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


def row(width, **cols):
    r = [''] * width
    for i, v in cols.items():
        r[int(i[1:])] = str(v)
    return '\t'.join(r)


def run_case(var_name, annotated):
    """One call to `caller`, whose target the oracle names as a bodiless signature.

    The engine names an ARROW in a DIFFERENT file, bound to a variable called
    `var_name`, annotated or not. Returns (wrong, impl_credit).
    """
    work = tempfile.mkdtemp()
    try:
        ir = os.path.join(work, 'ir')
        out = os.path.join(work, 'out')
        os.makedirs(ir)
        os.makedirs(out)
        sig_file = os.path.join(work, 'types.ts')      # where the signature lives
        impl_file = os.path.join(work, 'impl.ts')      # where the arrow lives

        with open(os.path.join(ir, 'all-typescript-modules.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(27, c3='filePath', c26='hash') + '\n')
            fh.write(row(27, c3='src/caller.ts', c26='MOD_C') + '\n')

        with open(os.path.join(ir, 'all-typescript-expressions.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(34, c33='hash') + '\n')
            fh.write(row(34, c20=10, c21=1, c22=10, c23=20, c33='S_1') + '\n')

        # The call is to the NAME the variable holds.
        with open(os.path.join(ir, 'all-typescript-call-sites.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(7, c5='ce', c6='mod') + '\n')
            fh.write(row(7, c0='FUNCTION_CALL', c1='doIt', c5='S_1', c6='MOD_C') + '\n')

        # Two declarations: the bodiless signature (oracle) and the arrow (engine).
        # Names differ, files differ — exactly what the old gate required to be equal.
        with open(os.path.join(ir, 'all-typescript-methods.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(43, c42='hash') + '\n')
            fh.write(row(43, c0='_', c4=sig_file, c5=2, c16='TYPE_LITERAL_METHOD_SIGNATURE',
                         c39=3, c42='M_SIG') + '\n')
            fh.write(row(43, c0='<arrow>', c4=impl_file, c5=58, c16='ARROW_FUNCTION',
                         c39=59, c42='M_IMPL') + '\n')

        # The link that carries the idiom: the arrow is bound to a variable.
        with open(os.path.join(ir, 'all-typescript-variables.csv'), 'w', encoding='utf-8') as fh:
            fh.write(row(31, c0='name', c19='boundFunction', c20='typeReference') + '\n')
            fh.write(row(31, c0=var_name, c19='M_IMPL',
                         c20=('TS_TYPE_REFERENCE_1' if annotated else '')) + '\n')

        with open(os.path.join(out, 'call-chain-edges.csv'), 'w', encoding='utf-8') as fh:
            fh.write('\t'.join(['S_1', 'C', 'TE', 'M_IMPL', 'p', 'RESOLVED', 'k']) + '\n')

        with open(os.path.join(work, 'oracle.tsv'), 'w', encoding='utf-8') as fh:
            fh.write(row(14, c0='f') + '\n')
            fh.write(row(14, c0='src/caller.ts', c1=10, c2=1, c3=10, c4=20,
                         c7=sig_file, c8=2, c9=3, c11='TYPE_LITERAL_METHOD_SIGNATURE',
                         c12=1, c13=0) + '\n')

        proc = subprocess.run([sys.executable, SCORE, ir, out,
                               os.path.join(work, 'oracle.tsv')],
                              capture_output=True, text=True)
        if proc.returncode != 0:
            bad(f'score.py exited {proc.returncode}')
            print(proc.stdout[-1500:], proc.stderr[-800:])
            return None, None
        w = re.search(r'^WRONG\s+(\d+)', proc.stdout, re.M)
        i = re.search(r"implementation of tsc's signature\s+(\d+)", proc.stdout)
        return (int(w.group(1)) if w else 0), (int(i.group(1)) if i else 0)
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ── the idiom earns the credit ───────────────────────────────────────────────
wrong, impl = run_case('doIt', annotated=True)
if wrong is not None:
    if wrong == 0 and impl == 1:
        ok('an annotated const whose arrow the engine named earns the credit')
    else:
        bad(f'the idiom scored WRONG={wrong} impl-credit={impl}, expected 0 and 1 — '
            'the name and file of a signature and its implementation differ by '
            'construction, so a gate comparing them credits nothing (#237)')

# ── CONTROL 1: no annotation, no credit ─────────────────────────────────────
# The compiler's signature comes FROM the annotation. Without one there is nothing
# tying this arrow to the signature the oracle named, and crediting it would be
# manufacturing agreement.
wrong, impl = run_case('doIt', annotated=False)
if wrong is not None:
    if wrong == 1 and impl == 0:
        ok('control: an UNannotated const earns no credit')
    else:
        bad(f'an unannotated const scored WRONG={wrong} impl-credit={impl}, expected '
            '1 and 0 — the credit must require the annotation the signature comes from')

# ── CONTROL 2: a different name, no credit ──────────────────────────────────
# The call was to `doIt`. An arrow bound to some other variable is not what that name
# holds, and must not answer for it.
wrong, impl = run_case('somethingElse', annotated=True)
if wrong is not None:
    if wrong == 1 and impl == 0:
        ok('control: an arrow bound to a DIFFERENT name earns no credit')
    else:
        bad(f'a mismatched name scored WRONG={wrong} impl-credit={impl}, expected 1 '
            'and 0 — the credit must be tied to the name being called')

if failures:
    print(f'impl-signature-credit: {len(failures)} of {checks} checks FAILED')
    sys.exit(1)
print(f'impl-signature-credit: ok ({checks} checks)')
