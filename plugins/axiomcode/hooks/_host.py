"""_host.py — the hooks' input and output, in the shape of the host that runs them.

The hooks are written against one contract: `hook_event_name` PreToolUse / PostToolUse / UserPromptSubmit,
`tool_name` Bash / Read / Grep / Edit / Write, and context returned as
{"hookSpecificOutput": {"hookEventName": …, "additionalContext": …}}, or plain text on UserPromptSubmit.

Cursor runs the same hooks.json (it converts the events) but hands the scripts its own names and reads only
its own output:
  · input   hook_event_name beforeSubmitPrompt / preToolUse / postToolUse, tool_name Shell for Bash,
            workspace_roots and conversation_id where the others send cwd and session_id
  · output  one JSON object, {"additional_context": …}, with "continue": true on beforeSubmitPrompt.
            Plain text is a parse error, and hookSpecificOutput is ignored.
  · preToolUse output carries no context at all (only permission), so a PreToolUse hook says nothing there.
Cursor sets CURSOR_VERSION in every hook process and nowhere else, which is how a hook knows.
"""
import io, json, os, sys

CURSOR = bool(os.environ.get('CURSOR_VERSION'))
EVENTS = {'beforeSubmitPrompt': 'UserPromptSubmit', 'preToolUse': 'PreToolUse', 'postToolUse': 'PostToolUse',
          'sessionStart': 'SessionStart'}
TOOLS = {'Shell': 'Bash'}


def read():
    """the event from stdin, with Cursor's names mapped onto the ones the hooks use"""
    ev = json.load(sys.stdin)
    if CURSOR and isinstance(ev, dict):
        ev['hook_event_name'] = EVENTS.get(ev.get('hook_event_name'), ev.get('hook_event_name'))
        ev['tool_name'] = TOOLS.get(ev.get('tool_name'), ev.get('tool_name'))
        roots = ev.get('workspace_roots') or []
        if not ev.get('cwd') and roots:
            ev['cwd'] = roots[0]
        if not ev.get('session_id') and ev.get('conversation_id'):
            ev['session_id'] = ev['conversation_id']
    return ev


def emit(event, text):
    """print `text` as context for `event`, in the host's shape; nothing when there is nothing to say"""
    if not text:
        return
    if not CURSOR:
        print(json.dumps({'hookSpecificOutput': {'hookEventName': event, 'additionalContext': text}}))
        return
    if event == 'PreToolUse':
        return
    out = {'additional_context': text}
    if event == 'UserPromptSubmit':
        out['continue'] = True
    print(json.dumps(out))


def capture(event):
    """for a hook that prints plain text: under Cursor, collect what it prints and emit it once, at exit"""
    if not CURSOR:
        return
    import atexit
    real, buf = sys.stdout, io.StringIO()
    sys.stdout = buf

    def flush():
        sys.stdout = real
        emit(event, buf.getvalue().strip())
        real.flush()
    atexit.register(flush)
