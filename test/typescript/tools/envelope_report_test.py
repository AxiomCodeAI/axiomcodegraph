#!/usr/bin/env python3
"""AN EDGE OUTSIDE THE DISPATCH ENVELOPE IS NOT, BY ITSELF, A FALSE POSITIVE.

`score.py` printed `edges OUTSIDE the CHA envelope (demonstrable false positives)` over
one total. For a receiver whose type is a class that reading is exact — the envelope
enumerated every assignable class, so a target outside it cannot be the runtime
receiver. For a global there is no receiver to enumerate over, and for a member on a
library interface the bound is only the resolved symbol's declarations, so `outside`
means "a declaration this symbol does not have" — weaker than "fabricated".

Measured on two dev projects before this changed: 2,728 edges carried that label and
**74** of them sat on a site the scorer itself called WRONG. The other 2,654 sat on
sites scoring EXACT or SOUND_SUPERSET — the engine's set already contained the
compiler's answer, and the outside edge was a SECOND declaration of a right answer. A
reader taking the line at face value would have counted a 37x overstatement. On the
smaller project all six such edges were on SOUND_SUPERSET sites and none was a
candidate fabrication.

SCORING §4 calls the fabrication-vs-over-approximation split "the most informative
number in the report". This checks that the report actually produces it. See #242.

SYNTHESISED INPUTS — no parser, no solver, no compiler, no work directory, so this
cannot skip and cannot decay when a fixture moves.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCORE = os.path.join(HERE, '..', 'ground-truth', 'score.py')

checks = 0
failures = []


def ok(msg):
    global checks
    checks += 1
    if os.environ.get('ENVELOPE_TEST_VERBOSE'):
        print(f'  ok    {msg}')


def bad(msg):
    global checks
    checks += 1
    failures.append(msg)
    print(f'  FAIL  {msg}')


def row(width, **cols):
    """A TSV row of `width` fields with the named POSITIONAL columns set.

    score.py indexes its inputs positionally, so the fixture states the index it means
    rather than relying on a header it does not read.
    """
    r = [''] * width
    for i, v in cols.items():
        r[int(i[1:])] = str(v)
    return '\t'.join(r)


def build(work):
    ir = os.path.join(work, 'ir')
    out = os.path.join(work, 'out')
    os.makedirs(ir)
    os.makedirs(out)
    # Absolute target paths on BOTH sides: score.py identifies a declaration by
    # resolved path, and a relative path would be realpath'd against the scorer's cwd
    # on the oracle side only.
    libx = os.path.join(work, 'libx.d.ts')
    app = os.path.join(work, 'app.ts')

    with open(os.path.join(ir, 'all-typescript-modules.csv'), 'w', encoding='utf-8') as fh:
        fh.write(row(27, c3='filePath', c26='hash') + '\n')
        fh.write(row(27, c3='src/app.ts', c26='MOD') + '\n')

    # Three call sites. The SPAN is the join key on both sides.
    spans = {'S1': (10, 1, 10, 12), 'S2': (20, 1, 20, 12), 'S3': (25, 1, 25, 12)}
    with open(os.path.join(ir, 'all-typescript-expressions.csv'), 'w', encoding='utf-8') as fh:
        fh.write(row(34, c20='sl', c21='sc', c22='el', c23='ec', c33='hash') + '\n')
        for ce, (sl, sc, el, ec) in spans.items():
            fh.write(row(34, c20=sl, c21=sc, c22=el, c23=ec, c33=ce) + '\n')

    with open(os.path.join(ir, 'all-typescript-call-sites.csv'), 'w', encoding='utf-8') as fh:
        fh.write(row(7, c0='kind', c1='callee', c5='ce', c6='mod') + '\n')
        for ce, name in (('S1', 'alpha'), ('S2', 'beta'), ('S3', 'gamma')):
            fh.write(row(7, c0='FUNCTION_CALL', c1=name, c5=ce, c6='MOD') + '\n')

    # Four declarations the engine can name. Positions are what the envelope compares.
    meths = [
        ('M_A5', libx, 5, 1, 'alpha'),
        ('M_A9', libx, 9, 1, 'alphaOther'),
        ('M_G12', libx, 12, 1, 'gamma'),
        ('M_B30', app, 30, 1, 'beta'),
        ('M_B40', app, 40, 1, 'betaOther'),
    ]
    with open(os.path.join(ir, 'all-typescript-methods.csv'), 'w', encoding='utf-8') as fh:
        fh.write(row(43, c0='name', c4='file', c5='line', c16='kind', c39='col', c42='hash') + '\n')
        for h, f, line, col, name in meths:
            fh.write(row(43, c0=name, c4=f, c5=line, c16='FUNCTION_DECLARATION',
                         c39=col, c42=h) + '\n')

    # THE ENGINE'S ANSWER.
    #   S1  two targets, one of which the oracle also names -> SOUND_SUPERSET
    #   S2  one target, and it is not the oracle's           -> WRONG
    #   S3  one target, the oracle's                         -> EXACT
    with open(os.path.join(out, 'call-chain-edges.csv'), 'w', encoding='utf-8') as fh:
        for ce, to in (('S1', 'M_A5'), ('S1', 'M_A9'), ('S2', 'M_B40'), ('S3', 'M_G12')):
            fh.write('\t'.join([ce, 'CALLER', 'TE', to, 'prov', 'RESOLVED', 'kind']) + '\n')

    with open(os.path.join(work, 'oracle.tsv'), 'w', encoding='utf-8') as fh:
        fh.write(row(14, c0='f', c7='tf', c8='tl', c9='tc', c11='tk') + '\n')
        for ce, tf, tl, tc in (('S1', libx, 5, 1), ('S2', app, 30, 1), ('S3', libx, 12, 1)):
            sl, sc, el, ec = spans[ce]
            fh.write(row(14, c0='src/app.ts', c1=sl, c2=sc, c3=el, c4=ec,
                         c7=tf, c8=tl, c9=tc, c11='FUNCTION_DECLARATION',
                         c12=1, c13=0) + '\n')

    # THE ENVELOPE, deliberately tight: it holds only the declaration the compiler
    # named at each site. So S1's second engine target and S2's only one fall OUTSIDE,
    # and S3's falls inside.
    with open(os.path.join(work, 'envelope.tsv'), 'w', encoding='utf-8') as fh:
        fh.write('\t'.join(['callFile', 'callLine', 'callCol', 'callEndLine', 'callEndCol',
                            'callKind', 'calleeName', 'mustTarget', 'chaCount', 'rtaCount',
                            'chaTargets', 'rtaTargets']) + '\n')
        for ce, tgt in (('S1', 'libx.d.ts:5:1'), ('S2', 'app.ts:30:1'), ('S3', 'libx.d.ts:12:1')):
            sl, sc, el, ec = spans[ce]
            fh.write('\t'.join(['src/app.ts', str(sl), str(sc), str(el), str(ec),
                                'FUNCTION_CALL', 'x', tgt, '1', '1', tgt, tgt]) + '\n')
    return ir, out


def main():
    work = tempfile.mkdtemp()
    try:
        ir, out = build(work)
        proc = subprocess.run(
            [sys.executable, SCORE, ir, out, os.path.join(work, 'oracle.tsv'),
             f'--envelope={os.path.join(work, "envelope.tsv")}'],
            capture_output=True, text=True)
        text = proc.stdout
        if proc.returncode != 0:
            bad(f'score.py exited {proc.returncode}')
            print(text[-2000:])
            print(proc.stderr[-1000:])
            return

        # 1. THE CLAIM THE BOUND CANNOT CARRY IS GONE. The envelope adjudicates a class
        #    receiver; it does not demonstrate that a global's target was invented.
        if 'demonstrable false positives' in text:
            bad('the report still calls every outside-envelope edge a demonstrable false positive')
        else:
            ok('the "demonstrable false positives" claim is no longer asserted over the total')

        # 2. THE SPLIT SCORING §4 ASKS FOR. Two outside edges, on sites with two
        #    different verdicts — the report must separate them.
        if not re.search(r'by the verdict of the SITE the edge sits on', text):
            bad('the outside-envelope total is not decomposed by site verdict')
        else:
            ok('outside-envelope edges are decomposed by the verdict of their site')

        m = re.search(r'edges OUTSIDE the CHA envelope\s+(\d+)', text)
        if not m or m.group(1) != '2':
            bad(f'expected 2 outside-envelope edges, report says {m.group(1) if m else "nothing"}')
        else:
            ok('outside-envelope total is 2')

        # 3. ONE of the two is on a WRONG site and is the only fabrication candidate.
        if not re.search(r'^\s+1\s+WRONG\s+<- candidate fabrication', text, re.M):
            bad('the one outside edge on a WRONG site is not identified as the fabrication candidate')
        else:
            ok('the WRONG-site edge is marked as the candidate fabrication')

        # 4. The other is on a site whose answer already CONTAINS the compiler's, which
        #    is the population that made the old label a 37x overstatement.
        if not re.search(r'^\s+1\s+SOUND_SUPERSET\s*$', text, re.M):
            bad('the outside edge on an already-correct site is not reported apart')
        else:
            ok('the outside edge on a SOUND_SUPERSET site is reported apart from it')

        # 5. A `.d.ts` target is bounded by a symbol, not by a class set. One of the two.
        if not re.search(r'the target is a \.d\.ts DECLARATION\s+1\b', text):
            bad('the declaration-file split of outside-envelope edges is wrong or absent')
        else:
            ok('outside-envelope edges are split by whether the target is a declaration')

        # 6. CONTROL — the pre-existing envelope numbers must not move. This decomposition
        #    is a change to how a total is EXPLAINED, not to what is counted; an edge
        #    inside the bound stays inside it.
        if not re.search(r'engine edges emitted\s+4\b', text):
            bad('CONTROL: the emitted-edge count changed')
        elif not re.search(r'inside CHA envelope\s+2\b', text):
            bad('CONTROL: the inside-envelope count changed')
        else:
            ok('control: emitted and inside-envelope counts are unchanged')

        # 7. CONTROL — an edge INSIDE the envelope must never be listed as outside it.
        if 'libx.d.ts:12:1' in text.split('edges OUTSIDE')[-1]:
            bad('CONTROL: an edge inside the envelope was listed among the outside ones')
        else:
            ok('control: the inside-envelope edge is not listed as outside')
    finally:
        shutil.rmtree(work, ignore_errors=True)


main()
if failures:
    print(f'envelope-report: FAILED ({checks} checks, {len(failures)} failed)')
    sys.exit(1)
print(f'envelope-report: ok ({checks} checks)')
