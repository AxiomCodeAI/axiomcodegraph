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

# NEITHER IS AVAILABLE, AND THAT IS NOT A REASON TO SERVE NOTHING (#1105). server.py carries a
# dependency-free fallback for the sliver of the protocol it uses, so the right move is to start it with
# whatever interpreter exists and let it say on stderr which half it is running. Refusing here is what
# left the client reporting a failed connection with no explanation.
for PY in python3 python; do
  command -v "$PY" >/dev/null 2>&1 && exec "$PY" "$SERVER" "$@"
done

echo "axiomcode mcp: no python3 on PATH, so the server cannot start at all." >&2
echo "  The skill's CLI needs python3 too; install it, or set AXIOMCODE_PYTHON." >&2
exit 1
