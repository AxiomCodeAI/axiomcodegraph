#!/usr/bin/env bash
# Keep A0 <-> A3 communication alive without anyone polling.
#
#   git config axiom.agent A0        # once, per worktree
#   bash tools/install-hooks.sh
#
# Installs a post-commit hook that prints anything the other agents routed to you
# since your last commit. A commit is the natural sync point: you have just
# finished a unit of work and are about to pick the next one.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HOOK="$ROOT/.git/hooks/post-commit"

cat > "$HOOK" <<'HOOKBODY'
#!/usr/bin/env bash
# AxiomCode fleet: show this agent's inbox after every commit.
AGENT="$(git config --get axiom.agent || true)"
if [ -z "$AGENT" ]; then
  echo "[fleet] no agent identity — run: git config axiom.agent A0"
  exit 0
fi
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 0
npx tsx src/test/python-oracle/status.ts --inbox --for "$AGENT" 2>/dev/null || true
HOOKBODY

chmod +x "$HOOK"
AGENT="$(git config --get axiom.agent || echo '<unset>')"
echo "installed $HOOK"
echo "  agent identity: $AGENT"
[ "$AGENT" = "<unset>" ] && echo "  set it with: git config axiom.agent A0"
echo
echo "Also available:"
echo "  npx tsx src/test/python-oracle/status.ts --watch --for \$AGENT   # live, 5s poll"
echo "  npx tsx src/test/python-oracle/status.ts --inbox --for \$AGENT   # new items only"
exit 0
