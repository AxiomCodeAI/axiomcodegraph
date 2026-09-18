#!/usr/bin/env python3
"""UserPromptSubmit: answer "where is this" before the agent thinks to ask.

The active verbs only help an agent that calls them, and the one measurement of this skill in an agent's
hands recorded no graph queries at all in six of six runs — the gap was never the answer, it was that
nobody asked the question. The passive half already enriches a Read or a grep AFTER the agent has chosen
where to look; this fires BEFORE, on the task itself, which is the only moment where orientation changes
which file gets opened first.

Rules it holds itself to:
  · ONCE per session. Orientation is a first-turn need; repeating it on every prompt is noise that costs
    context on every turn and changes nothing after the first.
  · SILENT unless it has something. No graph, no index, nothing matching — say nothing at all rather than
    announce that it has no answer.
  · BOUNDED. A handful of lines. This is a nudge toward the right package, not a second answer competing
    with what the agent asked for.
  · It never says it is certain. When several roots match it offers them instead of choosing, because
    picking the wrong package confidently is the failure this skill has already been bitten by.
"""
import json, os, subprocess, sys

MARK = '.axiomcode/.oriented'          # once per session, per repo
MAX_LINES = 14

try:
    ev = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cwd = ev.get('cwd') or os.getcwd()
prompt = (ev.get('prompt') or '').strip()
if len(prompt) < 25:                                   # too short to carry a task
    sys.exit(0)
if not os.path.exists(os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')):
    sys.exit(0)
stamp = os.path.join(cwd, MARK)
if os.path.exists(stamp):
    sys.exit(0)

here = os.path.dirname(os.path.abspath(__file__))
ctx = os.path.join(here, '..', 'skills', 'axiomcode', 'scripts', 'axiomcode-context')
try:
    r = subprocess.run([sys.executable, ctx, prompt, cwd, '--budget', '6'],
                       capture_output=True, text=True, timeout=25)
except Exception:
    sys.exit(0)

out = (r.stdout or '').strip()
if not out:
    sys.exit(0)
try:
    os.makedirs(os.path.dirname(stamp), exist_ok=True)
    open(stamp, 'w').write('1')
except Exception:
    pass

# The verb REFUSES without a scope, which is right when someone asked it a question and wrong here: nothing
# was asked, so a demand for an argument is noise. The refusal still carries the useful part — which roots
# the task's own words land in — so it is reworded as the observation it actually is.
lines = [l for l in out.splitlines() if l.strip()]
refused = any('--in <path> is required' in l for l in lines)
if refused:
    roots = [l.strip() for l in lines if l.strip().startswith('--in ')][:5]
    if not roots:
        sys.exit(0)
    print("graph: the words in this task land mostly here, before you search —")
    for r in roots:
        path, _, rest = r[len('--in '):].partition(' ')
        # the verb marks each row with the task's own words that were found under it; carry those through
        # rather than restating that there was a match, which told the reader nothing about WHICH match
        _, _, hits = rest.partition('<- ')
        print(f"  {path}" + (f"   <- {hits.strip()}" if hits.strip() else ''))
    print('  `axiomcode context "<the task>" --in <one of these>` ranks the files and declarations inside it.')
else:
    print("graph: where this task's own words land in the index —")
    for l in lines[:MAX_LINES]:
        print("  " + l[:150])
    print('  a starting point, not a conclusion: `impact <name> --in <path>` for what a change reaches.')
