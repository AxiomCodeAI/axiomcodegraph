#!/usr/bin/env bash
# ── Nothing a test depends on may be invisible to git ────────────────────────
# A fixture input that .gitignore matches is the worst kind of broken: `git add -A`
# reports success, the file never enters the index, the working tree keeps it so every
# local run passes, and the gate only fails for the next person to clone. It happened:
# a vendored fixture package's `dist/index.d.ts` — hand-written SOURCE that the fixture
# exists to stage — was swallowed by the repo-wide `dist/` rule that has been in
# .gitignore since the first commit and is correct everywhere else.
#
# The repo already carries a "never ignore engine source" safety net for `src/**`.
# There was none for `test/**`, which is this guard.
#
# Checks BOTH directions, because either alone passes while broken:
#   1. a file present on disk under test/ that git is ignoring — the case above, and the
#      one a local run can actually see;
#   2. a file a fixture's manifest points at that is not in the index at all — catches
#      the same fault after a fresh clone, where the ignored file simply is not there.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

fail=0

# ── 1. present on disk, ignored by git ───────────────────────────────────────
# --no-index so a file that IS tracked (and therefore fine) is not reported.
ignored=$(git ls-files --others --ignored --exclude-standard -- test/ 2>/dev/null \
          | grep -vE '(^|/)(\.work|\.work-[^/]*|__pycache__|node_modules)(/|$)' || true)
if [ -n "$ignored" ]; then
  echo "FAIL  these files exist under test/ but git is IGNORING them, so they are not"
  echo "      in the repository and every run that passes locally will fail on a clone:"
  printf '%s\n' "$ignored" | sed 's/^/        /'
  echo "      Either commit them with a .gitignore exception, or delete them if they are"
  echo "      generated output that a run should recreate."
  fail=1
fi

# ── 2. a vendored fixture package whose declared types are not in the index ──
# The manifest is the authority on what the package publishes; if that file is missing
# from git the fixture stages a package with no declarations and asserts on nothing.
while IFS= read -r manifest; do
  [ -n "$manifest" ] || continue
  types=$(python3 - "$manifest" <<'PY'
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
t = m.get('types') or m.get('typings') or ''
e = m.get('exports')
if isinstance(e, dict) and isinstance(e.get('.'), dict):
    t = e['.'].get('types') or t
print(t if isinstance(t, str) else '')
PY
)
  [ -n "$types" ] || continue
  target="$(dirname "$manifest")/${types#./}"
  if ! git ls-files --error-unmatch "$target" >/dev/null 2>&1; then
    echo "FAIL  $manifest declares types \"$types\" but $target is NOT in the index."
    echo "      The fixture would stage a package with no declarations."
    fail=1
  fi
done < <(git ls-files -- 'test/**/vendor/**/package.json' 'test/**/pnpm-vendor/**/package.json' 2>/dev/null)

[ "$fail" -eq 0 ] && echo "no-ignored-fixtures: ok"
exit $fail
