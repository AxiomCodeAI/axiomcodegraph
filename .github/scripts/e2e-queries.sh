#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Every query verb returns the RIGHT answer on a tiny project whose answers are known.
#
#   e2e-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>
#
# <fixture-dir> is .github/e2e/<language>/: entry() calls helper() calls leaf(), one test
# calls entry(), and `expect` names the four in that language's spelling. The project is
# copied to <work-dir>, committed, indexed, and asked:
#
#   impact LEAF            lists HELPER, the method that calls it
#   path ENTRY LEAF        reached, through HELPER
#   path ENTRY LEAF        the same from the shipped Datalog programs (AXIOMCODE_DATALOG=1)
#   path … --every         at least one route listed, both backends
#   context LEAF           names LEAF
#   impact <qualified>     the same caller, by the graph's own spelling (src/service#leaf), by the
#                          dotted one every language accepts (src.service.leaf), and by file:line
#   impact LEAF --json     parses, and names HELPER (hooks and MCP read this)
#   path '*' LEAF          ENTRY reaches it
#   impact, path (Datalog) with os.symlink refused, as for an unelevated Windows user (#1363)
#   Windows: impact run from a directory holding a git.exe, python.exe and py.exe (#1332)
#   graph --out, help impact, --version
#   leaf's 41 becomes 42, then
#   changed                names LEAF
#   changed --impact       names HELPER as reached
#   test-impact            selects TEST
#
# Running is not passing: each answer has to contain what the project makes true, and no
# answer may carry a Python traceback.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
bin="${1:?usage: e2e-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>}"; fx="${2:?fixture-dir}"; R="${3:?work-dir}"
fail() { echo "::error::e2e queries ($(basename "$fx")): $*"; exit 1; }
# shellcheck disable=SC2046
eval "$(cat "$fx/expect")"
rm -rf "$R"; mkdir -p "$R"; cp -R "$fx"/. "$R"/; rm -f "$R/expect"
git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.email=e2e@axiomcode -c user.name=e2e commit -qm base \
  || fail "could not commit the fixture"

"$bin" index "$R" > "$R/.index.log" 2>&1 || { tail -20 "$R/.index.log"; fail "axiomcode index exited non-zero"; }
grep 'datalog rules ready' "$R/.index.log" | sed 's/^/   /'

run() {  # <env> <verb and args…>: the answer lands in $R/.q.log, a non-zero exit or a traceback fails
  local env="$1"; shift; LABEL="$* ${env:+($env)}"
  ( cd "$R" && env $env "$bin" "$@" ) > "$R/.q.log" 2>&1; local rc=$?
  if [ "$rc" -ne 0 ] || grep -q 'Traceback (most recent call last)' "$R/.q.log"; then
    sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: rc=$rc"
  fi
}
must() {  # <extended regex> the last answer has to match, and why
  grep -Eq -- "$1" "$R/.q.log" || { sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: expected /$1/ ($2)"; }
  echo "   ok  $LABEL  — $2"
}
DL="AXIOMCODE_DATALOG=1"
run "" impact "$LEAF";                          must "\[resolved\] ([A-Za-z_.]*\.)?$HELPER .*calls it" "$HELPER is a resolved caller"
for e in "" "$DL"; do
  run "$e" path "$ENTRY" "$LEAF";               must "reached" "a chain exists"
                                                must "→ .*([A-Za-z_.]*\.)?$HELPER " "the chain goes through $HELPER"
  run "$e" path "$ENTRY" "$LEAF" --every;       must "[0-9]+ hop\(s\): .*$HELPER.* → .*$LEAF" "a route through $HELPER to $LEAF is listed"
done
run "" context "$LEAF";                         must "^ +([A-Za-z_.]*\.)?$LEAF +" "$LEAF is an entry point"

# ── the same declaration in every spelling a user or an agent writes it (#1360) ──────────────
# read from the graph, not written into the fixture: whatever the language calls it, the native
# spelling, the dotted one and file:line must each answer for it
win=""; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) win=1;; esac
native_path() { if [ -n "$win" ]; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
read -r QLEAF LEAF_AT < <(node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  const r = db.prepare("SELECT qualified_name q, file f, line l FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> ? ORDER BY length(qualified_name) LIMIT 1").get(process.argv[2], "module");
  if (r) console.log(r.q, `${r.f}:${r.l}`);
' "$(native_path "$R/.axiomcode/out/graph.sqlite")" "$LEAF" 2>/dev/null)
[ -n "${QLEAF:-}" ] || fail "the graph has no declaration named $LEAF"
DOTTED="$(printf '%s' "$QLEAF" | sed -e 's/::/./g' -e 's/[\/\\#$]/./g' -e 's/\.\.*/./g' -e 's/^\.//' -e 's/\.$//')"
for t in "$QLEAF" "$DOTTED" "$LEAF_AT"; do
  run "" impact "$t";                           must "\[resolved\] ([A-Za-z_.]*\.)?$HELPER .*calls it" "$HELPER is a resolved caller"
done
run "" impact "$LEAF" --json;                   must "\"$HELPER\"|[.#/]$HELPER\"" "the JSON names $HELPER"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$(native_path "$R/.q.log")" \
  || { head -c 600 "$R/.q.log"; fail "impact --json is not one JSON document"; }
run "" path '*' "$LEAF";                        must "([A-Za-z_.]*\.)?$ENTRY\b" "$ENTRY reaches $LEAF"

# ── a user who may not create symlinks, as on Windows without elevation (#1363) ───────────────
NOSYM="$R.nosymlink"; mkdir -p "$NOSYM"
printf 'import os\ndef _deny(*a, **k):\n    raise OSError(1314, "A required privilege is not held by the client")\nos.symlink = _deny\n' > "$NOSYM/sitecustomize.py"
NS="PYTHONPATH=$(native_path "$NOSYM")"
run "$NS" impact "$LEAF";                       must "\[resolved\] ([A-Za-z_.]*\.)?$HELPER .*calls it" "$HELPER is a caller without symlinks"
run "$NS $DL" path "$ENTRY" "$LEAF";            must "reached" "the Datalog path answers without symlinks"

# ── Windows: a git.exe / python.exe / py.exe in the working directory is not the one run (#1332) ──
if [ -n "$win" ]; then
  TRAP="$R.trap"; mkdir -p "$TRAP"
  for n in git python python3 py; do cp "$(cygpath -u "${SYSTEMROOT:-C:\\Windows}")/System32/cmd.exe" "$TRAP/$n.exe"; done
  LABEL="impact $LEAF from a directory holding git.exe, python.exe and py.exe"
  ( cd "$TRAP" && "$bin" impact "$LEAF" "$R" ) > "$R/.q.log" 2>&1 \
    || { sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: rc=$?"; }
  must "\[resolved\] ([A-Za-z_.]*\.)?$HELPER .*calls it" "the programs in the working directory were not run"
fi

# ── the rest of the CLI: graph, help, --version ───────────────────────────────────────────────
run "" graph --out "$R/.graph.html"
[ -s "$R/.graph.html" ] || fail "graph --out wrote no page"; echo "   ok  graph --out  — $(wc -c < "$R/.graph.html" | tr -d ' ') bytes"
run "" help impact;                             must "axiomcode impact" "help describes impact"
want="$(node -p 'require(process.argv[1]).version' "$(native_path "$(dirname "$bin")/../@axiomcode/code-graph/package.json")" 2>/dev/null)"
run "" --version;                               must "^${want//./\\.}\$" "--version is the installed version ($want)"

# a real edit to leaf's body: what changed, and which tests have to run for it
sed 's/41/42/' "$R/$LEAF_FILE" > "$R/.edit" && mv "$R/.edit" "$R/$LEAF_FILE"
git -C "$R" diff --quiet && fail "the edit to $LEAF_FILE changed nothing"
run "" changed;                                 must "([A-Za-z_.]*\.)?$LEAF\b" "$LEAF is reported changed"
run "" changed --impact;                        must "([A-Za-z_.]*\.)?$HELPER\b" "the edit hook's answer reaches $HELPER"
run "" test-impact;                             must "^tests to run: [1-9]" "a test reaches the change through the graph"
                                                must "^ +\S*$TEST\S* +\(" "$TEST is the test selected"
echo "e2e queries: every verb answered correctly for $(basename "$fx")"
