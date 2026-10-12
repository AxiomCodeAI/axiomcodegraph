#!/usr/bin/env python3
"""Stop: when the turn's work stood on an AxiomCode answer, say so under the reply (#1935).

Agents finish with and without the graph, and they rarely credit the answer they acted on, so the user never sees what
it did. At the end of each turn this reads the session's transcript and prints, for each chain new in that turn, one
line the user can check (skills/axiomcode/scripts/ax_assists.py holds the rules):

    ◆ AxiomCode this turn · 1 answer led the agent's work
      • Helped: `impact total` showed pricing.py (new to the agent) → it edited it → both picked test files (…) pass

Rules it holds itself to:
  · NOTHING FROM THE AGENT'S TEXT. The reply has already been shown when this runs; every link is read from the tool
    calls and their results, and a link that was not checked is not printed.
  · SILENT unless an answer led somewhere: no query, or a query nobody acted on, prints nothing. Only what helped is
    counted; the answers that led nowhere are never shown.
  · SHOWN ONCE. In the terminal (CLAUDE_CODE_ENTRYPOINT=cli) it is a message under the reply: the terminal shows
    a Stop hook's message, and would also show a hand-back's reason, so handing it back there prints it twice.
    Elsewhere (`-p`, the SDK, an IDE) a hook's message may never reach the user, so the receipt goes back to the
    agent once (decision "block"), which ends its reply with it word for word. The second stop (stop_hook_active)
    checks the reply carries every line; when it does not, the receipt is shown as a message instead. Gemini gets
    the message.
AXIOMCODE_ASSISTS=off turns it off.
"""
import json, os, subprocess, sys, time
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
ASK = ('AxiomCode checked the tool calls of this turn and recorded where its answers led your work. End your reply with '
       'the block below, copied exactly as written (inside a ``` block), and nothing else: run no tools, add no claims '
       'of your own about it.\n\n')


def _pending(root):
    return os.path.join(root, '.axiomcode', 'assists.pending.json')


def _quoted(transcript, msg):
    """whether the agent's text after the hand-back carries every line of the receipt"""
    want = [l.strip() for l in msg.splitlines() if l.strip()]
    for _ in range(6):                        # the host may still be writing the reply's last message
        said, after = [], False
        for line in open(transcript, encoding='utf-8', errors='replace'):
            try:
                e = json.loads(line)
            except ValueError:
                continue
            c = (e.get('message') or {}).get('content') if isinstance(e, dict) else None
            if e.get('type') == 'user' and ASK[:40] in json.dumps(c, ensure_ascii=False):
                said, after = [], True
            elif after and e.get('type') == 'assistant' and isinstance(c, list):
                said += [x.get('text') or '' for x in c if isinstance(x, dict) and x.get('type') == 'text']
        text = '\n'.join(said)
        if all(w in text for w in want):
            return True
        time.sleep(0.5)
    return False


if ev.get('stop_hook_active'):
    # the agent was handed the receipt; show it as a message only when its reply did not carry it
    try:
        pend = json.load(open(_pending(root)))
        os.remove(_pending(root))
    except Exception:
        sys.exit(0)
    if pend.get('session') == str(ev.get('session_id') or '') and not _quoted(tr, pend['msg']):
        print(json.dumps({'systemMessage': pend['msg']}))
    sys.exit(0)
try:
    import ax_assists
    msg = ax_assists.at_stop(tr, os.path.realpath(root), str(ev.get('session_id') or ''))
except Exception:
    sys.exit(0)                               # a receipt is never worth a failed turn
if not msg:
    sys.exit(0)
if _host.GEMINI or os.environ.get('CLAUDE_CODE_ENTRYPOINT') == 'cli':
    print(json.dumps({'systemMessage': msg}))
    sys.exit(0)
try:
    json.dump({'session': str(ev.get('session_id') or ''), 'msg': msg}, open(_pending(root), 'w'))
    print(json.dumps({'decision': 'block', 'reason': ASK + msg}))
except Exception:
    print(json.dumps({'systemMessage': msg}))
