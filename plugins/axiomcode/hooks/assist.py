#!/usr/bin/env python3
"""Stop: when the turn's work stood on an AxiomCode answer, say so under the reply (#1935).

Agents finish with and without the graph, and they rarely credit the answer they acted on, so the user never sees what
it did. At the end of each turn this reads the session's transcript and prints, for each chain new in that turn, one
line the user can check (skills/axiomcode/scripts/ax_assists.py holds the rules):

    ◆ AxiomCode this turn
      • Redirected: the agent was in OrderService.cs, Cart.cs; `path handleOrder PriceCalc` showed PriceCalc.cs …

Rules it holds itself to:
  · NOTHING FROM THE AGENT'S TEXT. The reply has already been shown when this runs; every link is read from the tool
    calls and their results, and a link that was not checked is not printed.
  · SILENT unless an answer led somewhere: no query, or a query nobody acted on, prints nothing.
  · NEVER BLOCKS. It prints a message for the user and exits 0; the agent's turn is over.
AXIOMCODE_ASSISTS=off turns it off.
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _host

if (os.environ.get('AXIOMCODE_ASSISTS') or '').lower() in ('off', '0', 'false', 'no'):
    sys.exit(0)
try:
    ev = _host.read()
except Exception:
    sys.exit(0)
if _host.CURSOR:                              # Cursor's stop hook takes no message for the user
    sys.exit(0)
tr = ev.get('transcript_path') or ''
if not tr or not os.path.isfile(tr):
    sys.exit(0)
cwd = ev.get('cwd') or os.getcwd()
try:
    r = subprocess.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel'], capture_output=True, text=True, timeout=5)
    root = r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else cwd
except Exception:
    root = cwd
try:
    import ax_assists
    msg = ax_assists.at_stop(tr, os.path.realpath(root), str(ev.get('session_id') or ''))
except Exception:
    sys.exit(0)                               # a receipt is never worth a failed turn
if msg:
    print(json.dumps({'systemMessage': msg}))
