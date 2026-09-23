#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A change that reaches a user needs a version they can ask for.
#
# npm does not let a published version be republished. So anything inside the
# tarball — and that includes README.md, which package.json's `files` allowlist
# names explicitly — can only reach anyone through a new version. A pull request
# that improves the README and leaves the version alone is not a small omission:
# the improvement is simply never delivered, and nothing anywhere says so. The
# next person reads the README on the registry, sees the old text, and has no
# way to tell it apart from a README nobody has written yet.
#
# The inverse error is the one worth avoiding here too. Demanding a bump for a
# CI tweak or a test fixture trains people to bump without asking why, and a
# version that moves for reasons users cannot observe stops meaning anything.
#
# So the gate asks one question: COULD THIS CHANGE REACH A USER? It answers it
# from package.json's own `files` declaration rather than a second list kept by
# hand, because a second list is a thing that drifts — which is the defect this
# repository keeps finding in other forms.
#
# NOT the engine packages. `@axiomcode/engine-<os>-<cpu>` is named by ENGINE_ID,
# a sha256 over the Soufflé version and the rule text and nothing else (see
# graph/pipeline/run-souffle.sh). A README cannot move it, and a rule change
# moves it whether or not anyone bumps anything. That gate is already correct
# and this script must not second-guess it.
#
# Usage: version-gate.sh <base-ref>        e.g. version-gate.sh origin/main
#        VERSION_GATE=off  skips the check (for a branch that is not yet publishing)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

[ "${VERSION_GATE:-on}" = off ] && { echo "version gate: off"; exit 0; }

base="${1:?usage: version-gate.sh <base-ref>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root" || exit 1

git rev-parse --verify --quiet "$base" >/dev/null || {
  echo "::error::version-gate: no such ref: $base"; exit 1; }

head_version="$(node -p "require('./package.json').version" 2>/dev/null)"
base_version="$(git show "$base:package.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null)"

[ -n "$head_version" ] && [ -n "$base_version" ] || {
  echo "::error::version-gate: could not read the version on both sides"; exit 1; }

# A bump was made. Whatever the change was, a user can ask for it by name.
if [ "$head_version" != "$base_version" ]; then
  echo "version: $base_version -> $head_version"
  exit 0
fi

# What cannot reach a user: the negations package.json already declares, read
# from the file so the two cannot disagree, plus CI configuration, which npm
# never packs and which no `files` entry would ever name.
# (a while-read loop, not mapfile: bash 3.2 is still what a macOS laptop runs)
excluded=()
while IFS= read -r e; do
  [ -n "$e" ] && excluded+=("$e")
done < <(node -e '
  const f = require("./package.json").files || [];
  for (const e of f) if (e.startsWith("!")) console.log(e.slice(1));
')
excluded+=(".github/")

reaches_a_user() {
  local path="$1"
  case "$path" in */__pycache__/*) return 1;; esac
  for e in "${excluded[@]}"; do
    case "$e" in
      */) [ "${path##"$e"}" != "$path" ] && return 1 ;;
       *) [ "$path" = "$e" ] && return 1 ;;
    esac
  done
  return 0
}

shipped=()
while IFS= read -r p; do
  [ -n "$p" ] || continue
  reaches_a_user "$p" && shipped+=("$p")
done < <(git diff --name-only "$base"...HEAD)

if [ ${#shipped[@]} -eq 0 ]; then
  echo "version $head_version unchanged; nothing in this change reaches a published artefact"
  exit 0
fi

echo "::error::version-gate: package.json is still $head_version, but ${#shipped[@]} changed file(s) reach a user"
printf '  %s\n' "${shipped[@]:0:20}"
[ ${#shipped[@]} -gt 20 ] && echo "  … and $(( ${#shipped[@]} - 20 )) more"
cat <<'WHY'

npm will not republish a version, so none of the above can be delivered under
0.x.y once 0.x.y is out. A docs-only change is still a delivery: README.md is in
the `files` allowlist and `description` is the registry page, so both reach users
and both want a patch bump — nothing larger.

If this change genuinely reaches nobody, it belongs under one of the paths
package.json already excludes, and the gate will say so on its own.
WHY
exit 1
