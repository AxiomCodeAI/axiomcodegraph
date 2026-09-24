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

Gemini CLI runs the repository root's hooks/hooks.json, which names its own events and tools:
  · input   hook_event_name BeforeAgent / BeforeTool / AfterTool; tool_name read_file (start_line,
            end_line), grep_search (dir_path), glob, run_shell_command, replace, write_file
  · output  hookSpecificOutput.additionalContext, as here, under Gemini's event name; stdout must be JSON
            only, so plain text is wrapped. BeforeTool output carries no context.
Those event names occur in no other host, which is how a hook knows.
"""
import io, json, os, sys

CURSOR = bool(os.environ.get('CURSOR_VERSION'))
EVENTS = {'beforeSubmitPrompt': 'UserPromptSubmit', 'preToolUse': 'PreToolUse', 'postToolUse': 'PostToolUse',
          'sessionStart': 'SessionStart'}
TOOLS = {'Shell': 'Bash'}
GEMINI_EVENTS = {'BeforeAgent': 'UserPromptSubmit', 'BeforeTool': 'PreToolUse', 'AfterTool': 'PostToolUse'}
GEMINI_TOOLS = {'read_file': 'Read', 'grep_search': 'Grep', 'grep': 'Grep', 'glob': 'Glob',
                'run_shell_command': 'Bash', 'replace': 'Edit', 'write_file': 'Write'}
GEMINI = None        # the Gemini event name this hook was called for, once read() has seen one


def read():
    """the event from stdin, with Cursor's or Gemini's names mapped onto the ones the hooks use"""
    global GEMINI
    ev = json.load(sys.stdin)
    if isinstance(ev, dict) and ev.get('hook_event_name') in GEMINI_EVENTS:
        GEMINI = ev['hook_event_name']
        ev['hook_event_name'] = GEMINI_EVENTS[GEMINI]
        ev['tool_name'] = GEMINI_TOOLS.get(ev.get('tool_name'), ev.get('tool_name'))
        inp = ev.get('tool_input') or {}
        if ev['tool_name'] == 'Read' and inp.get('start_line'):
            inp['offset'] = inp['start_line']
            if inp.get('end_line'):
                inp['limit'] = int(inp['end_line']) - int(inp['start_line']) + 1
        if ev['tool_name'] in ('Grep', 'Glob') and inp.get('dir_path') and not inp.get('path'):
            inp['path'] = inp['dir_path']
        ev['tool_input'] = inp
        return ev
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
    if GEMINI:
        if event != 'PreToolUse':
            print(json.dumps({'hookSpecificOutput': {'hookEventName': GEMINI, 'additionalContext': text}}))
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
    """for a hook that prints plain text: where stdout must be JSON (Cursor, Gemini), collect what it prints
    and emit it once, at exit. Call it after read()."""
    if not (CURSOR or GEMINI):
        return
    import atexit
    real, buf = sys.stdout, io.StringIO()
    sys.stdout = buf

    def flush():
        sys.stdout = real
        emit(event, buf.getvalue().strip())
        real.flush()
    atexit.register(flush)
