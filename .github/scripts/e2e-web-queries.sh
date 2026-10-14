#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Every query verb returns the RIGHT answer on a tiny site whose answers are known — the web (HTML + CSS) twin of
# e2e-queries.sh, which needs a call graph (entry → helper → leaf) a site does not have.
#
#   e2e-web-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>
#
# <fixture-dir> is .github/e2e/web/: index.html and pages/about.html load css/app.css, which @imports css/base.css;
# .btn is carried by an element on each page, .ghost by none. The site is copied to <work-dir>, committed, indexed,
# and asked:
#
#   impact .btn               the elements carrying it (one per page) and the selectors naming it
#   impact css/app.css        both pages load it; it imports base.css; .ghost matches nothing
#   impact index.html         about.html links to it; it loads base.css (import) and app.css (link), in that order
#   path index.html css/base.css   index.html → css/app.css → css/base.css
#   context .ghost            lands on css/app.css:5
#   impact .btn --json        one JSON document naming the class
#   impact, path, context with os.exec* ending the caller at once, as Windows' exec does (#1640)
#   padding 4px becomes 6px, then
#   impact (no name)          names the edited rule and the elements it styles
#   tests                     says the web graph selects none (HTML and CSS have none), exit 3
#
# A path is matched with either separator; no answer may carry a Python traceback.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
bin="${1:?usage: e2e-web-queries.sh <axiomcode-bin> <fixture-dir> <work-dir>}"; fx="${2:?fixture-dir}"; R="${3:?work-dir}"
fail() { echo "::error::e2e web queries: $*"; exit 1; }
native_path() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) cygpath -w "$1";; *) printf '%s' "$1";; esac; }
rm -rf "$R"; mkdir -p "$R"; cp -R "$fx"/. "$R"/
git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.email=e2e@axiomcode -c user.name=e2e commit -qm base \
  || fail "could not commit the fixture"

"$bin" index "$R" > "$R/.index.log" 2>&1 || { tail -20 "$R/.index.log"; fail "axiomcode index exited non-zero"; }

run() {  # <env> <verb and args…>: the answer lands in $R/.q.log, a non-zero exit or a traceback fails
  local env="$1"; shift; LABEL="$* ${env:+($env)}"
  ( cd "$R" && env $env "$bin" "$@" ) > "$R/.q.log" 2>&1; local rc=$?
  if [ "$rc" -ne 0 ] || grep -q 'Traceback (most recent call last)' "$R/.q.log"; then
    sed 's/^/     /' "$R/.q.log" | head -25; fail "$LABEL: rc=$rc"
  fi
}
must() {  # <extended regex> the last answer has to match, and why
  grep -Eq -- "$1" "$R/.q.log" || { sed 's/^/     /' "$R/.q.log" | head -30; fail "$LABEL: expected /$1/ ($2)"; }
  echo "   ok  $LABEL  — $2"
}
S='[/\\]'  # a path separator, either way round
btn_ok() {  # <why>: the last answer is .btn's impact
  must "^ +index\.html:8: button#buy\.btn\.primary" "$1 (the button on index.html)"
  must "^ +pages${S}about\.html:8: a\.btn" "$1 (the link on about.html)"
  must "css${S}app\.css:3: \.btn " "$1 (the selector naming it)"
}
path_ok() {  # <why>: the last answer is the chain index.html → app.css → base.css
  must "chain \(2 hop\(s\)\)" "$1 (two hops)"
  must "^ +css${S}app\.css +loads " "$1 (index.html loads app.css)"
  must "^ +css${S}base\.css +@import " "$1 (app.css imports base.css)"
}
ghost_ok() { must "css${S}app\.css:5: selector \.ghost" "$1 (.ghost is css/app.css:5)"; }

run "" impact .btn;                             btn_ok "the elements and selectors of .btn"
run "" impact css/app.css;                      must "^pages that load it: 2" "both pages load app.css"
                                                must "^ +css${S}base\.css \[match\]" "app.css imports base.css"
                                                must "css${S}app\.css:5: \.ghost +\[no_static_carrier\]" ".ghost matches nothing"
run "" impact index.html;                       must "^ +pages${S}about\.html:8: a\.btn \[href\]" "about.html links to it"
                                                must "^ +1\. css${S}base\.css +\[import" "base.css first in cascade order"
                                                must "^ +2\. css${S}app\.css +\[link\]" "app.css second"
run "" path index.html css/base.css;            path_ok "the page reaches the imported sheet"
run "" context .ghost;                          ghost_ok "context lands on the selector"
run "" impact .btn --json;                      must '"target": "\.btn"' "the JSON names .btn"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$(native_path "$R/.q.log")" \
  || { head -c 600 "$R/.q.log"; fail "impact --json is not one JSON document"; }

# ── os.exec* that does not replace the process, as on Windows (#1640) ─────────────────────────
NOEXEC="$R.noexec"; mkdir -p "$NOEXEC"
cat > "$NOEXEC/sitecustomize.py" <<'PY'
import os, subprocess, sys
def _leave(path, args, *env):
    subprocess.Popen(list(args), executable=path if os.sep in path else None, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os._exit(0)
for _n in ('execv', 'execve', 'execvp', 'execvpe'): setattr(os, _n, _leave)
for _n in ('execl', 'execle', 'execlp', 'execlpe'): setattr(os, _n, lambda path, *args: _leave(path, args))
sys.path.insert(0, os.environ.get('E2E_AX_SCRIPTS', ''))
try:
    import ax_exec; ax_exec.REPLACES = False
except ImportError: pass
finally: sys.path.pop(0)
PY
SCR="$(cd "$(dirname "$bin")/../@axiomcode/code-graph/plugins/axiomcode/skills/axiomcode/scripts" 2>/dev/null && pwd)"
[ -n "$SCR" ] || fail "the installed package has no plugin scripts next to $bin"
NX="PYTHONPATH=$(native_path "$NOEXEC") E2E_AX_SCRIPTS=$(native_path "$SCR")"
run "$NX" impact .btn;                          btn_ok "impact answers where exec does not replace the process"
run "$NX" path index.html css/base.css;         path_ok "path answers where exec does not replace the process"
run "$NX" context .ghost;                       ghost_ok "context answers where exec does not replace the process"

# a real edit to a rule: what changed, and what it styles
sed 's/padding: 4px/padding: 6px/' "$R/css/app.css" > "$R/.edit" && mv "$R/.edit" "$R/css/app.css"
git -C "$R" diff --quiet && fail "the edit to css/app.css changed nothing"
run "" impact;                                  must "^web: your edits" "the edit is reported"
                                                must "^ +css${S}app\.css: rule at line 3" "the edited rule is css/app.css:3"
                                                must "^ +pages${S}about\.html:8: a\.btn \[match\]" "it styles the link on about.html"
# tests: an empty selection is exit 3 (as every verb's "nothing found"), never 0 and never a crash
LABEL="tests"; ( cd "$R" && "$bin" tests ) > "$R/.q.log" 2>&1; rc=$?
[ "$rc" -eq 3 ] && ! grep -q 'Traceback (most recent call last)' "$R/.q.log" \
  || { sed 's/^/     /' "$R/.q.log" | head -25; fail "tests: rc=$rc (expected 3, an empty selection)"; }
                                                must "web graph selects no tests" "HTML and CSS have no tests to select"
echo "e2e web queries: every verb answered correctly"
