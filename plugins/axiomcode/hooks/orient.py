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

MARK = '.axiomcode/.oriented-{}'       # once per session: keyed by session id (one stamp per repo never fired again)
MAX_LINES = 14

try:
    ev = json.load(sys.stdin)
except Exception:
    sys.exit(0)

def repo_root(start):
    """The repository the prompt is about, which is not always where the shell happens to be.

    A graph lives at the root; an agent working in a subdirectory would otherwise be told the
    repository has none and sent into a multi-minute rebuild for a graph it already has. Nearest
    ancestor holding one wins; failing that the git root, so a repo that has never been indexed
    still reports against its root rather than against a subdirectory.
    """
    cur = os.path.realpath(start)
    while True:
        if os.path.exists(os.path.join(cur, '.axiomcode', 'out', 'graph.sqlite')):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    try:
        r = subprocess.run(['git', '-C', start, 'rev-parse', '--show-toplevel'],
                           capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    return os.path.realpath(start)


cwd = repo_root(ev.get('cwd') or os.getcwd())
prompt = (ev.get('prompt') or '').strip()
if len(prompt) < 25:                                   # too short to carry a task
    sys.exit(0)
stamp = os.path.join(cwd, MARK.format(ev.get('session_id') or 'x'))
if os.path.exists(stamp):
    sys.exit(0)

if not os.path.exists(os.path.join(cwd, '.axiomcode', 'out', 'graph.sqlite')):
    # The SILENT rule below is about having no ANSWER -- no index entry matches, nothing ranked. This is the
    # other case: there is no graph at all, so the caller cannot discover from any surface that one is available.
    # It is the only moment where saying nothing guarantees the skill is never used, so it says one thing and
    # takes the same once-per-repo stamp. Still bounded, still never repeated, and still silent where it would
    # be noise: a tree with no source in a supported language has nothing to offer and says nothing.
    EXT = ('.java', '.ts', '.tsx', '.py', '.js', '.jsx', '.mjs', '.cjs')
    SKIP = {'node_modules', '.git', 'dist', 'build', 'target', 'venv', '.venv', '__pycache__'}
    found = 0
    for root, dirs, files in os.walk(cwd):
        dirs[:] = [d for d in dirs if d not in SKIP and not d.startswith('.')]
        found += sum(1 for f in files if f.endswith(EXT))
        if found >= 25:                                    # enough to be a codebase rather than a script
            break
    if found < 25:
        sys.exit(0)
    try:
        os.makedirs(os.path.dirname(stamp), exist_ok=True)
        open(stamp, 'w').write('1')
    except Exception:
        pass
    entry = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          '..', 'skills', 'axiomcode', 'scripts', 'axiomcode'))
    # A build that ran and failed leaves the output directory and its log behind. Telling that caller to
    # "build one" invites them to repeat the failure; the log already says why it stopped.
    log = os.path.join(cwd, '.axiomcode', 'build.log')
    if os.path.isdir(os.path.join(cwd, '.axiomcode', 'out')) and os.path.exists(log):
        print("graph: a build ran here and produced no graph, so callers, change impact and test selection "
              "are unavailable.")
        print(f"  {log} says why it stopped; `{entry} index` re-runs it once that is addressed.")
    else:
        print("graph: this repository has no call graph yet, so callers, change impact and test selection are "
              "unavailable until one is built.")
        print(f"  `{entry} index` builds it (minutes on a large tree, once per commit); every other verb needs it.")
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
    # Keep the task itself. Orientation is the only moment anything in this plugin is told what the work is
    # about, and the passive half -- which annotates each file the agent opens -- has never known. Without it
    # that half can only rank what it finds by degree, which is a property of the code and not of the job.
    open(os.path.join(cwd, '.axiomcode', 'task.txt'), 'w').write(prompt[:20000])
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
