#!/usr/bin/env bash
# launch.sh — start the MCP server, resolving the Python MCP SDK rather than assuming it.
#
# server.py imports `mcp`, and nothing on a fresh machine installs it: the plugin declares no Python
# dependency and npm cannot express one. On the machine this was written on the import only worked
# because Anaconda happened to carry the SDK; on a clean install the server exits on ImportError before
# it speaks a single frame, and Claude Code reports a server that would not start -- with no hint that a
# missing Python package is the reason.
#
# Order: an interpreter that already has the SDK wins (fastest, no network, respects a venv the user set
# up). Otherwise uv fetches it into an ephemeral environment, which is the one command that works on a
# clean machine without asking to install anything globally. If neither is possible, say exactly what is
# missing and how to fix it -- on stderr, where Claude Code surfaces it -- instead of an ImportError.
set -u
SERVER="$(cd "$(dirname "$0")" && pwd)/server.py"

for PY in "${AXIOMCODE_PYTHON:-}" python3 python; do
  [ -n "$PY" ] || continue
  command -v "$PY" >/dev/null 2>&1 || continue
  if "$PY" -c 'import mcp' >/dev/null 2>&1; then exec "$PY" "$SERVER" "$@"; fi
done

if command -v uv >/dev/null 2>&1; then
  exec uv run --quiet --with mcp python "$SERVER" "$@"
fi

echo "axiomcode mcp: the Python MCP SDK is not installed for any interpreter on PATH." >&2
echo "  The skill's CLI still works (run scripts/axiomcode directly); only the MCP tools need this." >&2
echo "  Fix with ONE of:" >&2
echo "    pip install mcp            (into the interpreter python3 resolves to)" >&2
echo "    uv tool install uv         (then this launcher fetches the SDK on demand)" >&2
echo "    AXIOMCODE_PYTHON=/path/to/python-with-mcp" >&2
exit 1
