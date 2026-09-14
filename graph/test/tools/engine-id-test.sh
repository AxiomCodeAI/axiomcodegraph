#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The engine id (run-souffle.sh --print-engine-id) is what lets a machine WITHOUT souffle
# find the binary CI built for its rules, so two properties are load-bearing:
#   1. PATH-INDEPENDENT — the same tree at another path gives the same id (CI's checkout is
#      never at the user's path);
#   2. RULE-SENSITIVE — one character changed in one rule file changes it, in every language,
#      whether the file is a rule, a map, the manifest, or the pinned souffle version.
# Also: the emitted program contains no absolute path, and neither mode needs souffle.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker
RUN="graph/pipeline/run-souffle.sh"
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# a copy of the tree, at a different path, with souffle hidden from PATH
mkdir -p "$W/copy" "$W/bin"
cp -R "$ROOT/graph" "$W/copy/graph"; cp "$ROOT/package.json" "$W/copy/package.json"
for t in bash grep awk sed sort cut tr mktemp uname cat rm cp mv ls dirname basename shasum sha256sum stat; do
  p="$(command -v "$t" 2>/dev/null)" && ln -sf "$p" "$W/bin/$t"
done
id_at(){ ( cd "$1" && PATH="$W/bin" bash "$RUN" --language "$2" --print-engine-id ); }

for lang in java typescript python javascript; do
  a="$(id_at "$ROOT" "$lang")"; b="$(id_at "$W/copy" "$lang")"
  case "$a" in [0-9a-f]*) ;; *) bad "$lang: id is not a hex digest: '$a'";; esac
  [ "$a" = "$b" ] || bad "$lang: id differs between two paths ($a vs $b)"
  ( cd "$W/copy" && PATH="$W/bin" bash "$RUN" --language "$lang" --emit-program "$W/$lang.dl" )
  grep -q '^#include "/' "$W/$lang.dl" && bad "$lang: emitted program embeds an absolute include path"
  grep -q "^#include \"$lang/souffle/decls_base.dl\"" "$W/$lang.dl" || bad "$lang: emitted program does not include $lang/souffle/decls_base.dl"
  grep -q '^\.input ' "$W/$lang.dl" || bad "$lang: emitted program declares no inputs"
done

# sensitivity: touch one thing at a time in the copy and expect a new id
before="$(id_at "$W/copy" java)"
mutate(){ # $1 = file, $2 = appended text, $3 = label
  cp "$W/copy/$1" "$W/orig"; printf '%s\n' "$2" >> "$W/copy/$1"
  after="$(id_at "$W/copy" java)"
  [ "$after" != "$before" ] || bad "java: id unchanged after $3"
  mv "$W/orig" "$W/copy/$1"
}
f="$(cd "$ROOT" && ls graph/java/engine/resolution/*.dl | head -1)"
mutate "$f" "// changed" "editing a rule file ($f)"
mutate "graph/java/templates/client-ir.map" "zz_extra_relation	all-zz" "adding a staged relation"
mutate "graph/java/souffle/export_manifest.tsv" "zz_pred	zz.csv" "adding an export"
mutate "graph/pipeline/engine.conf" 'SOUFFLE_VERSION="9.9"' "bumping the pinned souffle version"
[ "$(id_at "$W/copy" java)" = "$before" ] || bad "java: id did not return to its original value after the mutations were reverted"
# and a change to one language must not move another's id
tsb="$(id_at "$W/copy" typescript)"; printf '// changed\n' >> "$W/copy/$f"
[ "$(id_at "$W/copy" typescript)" = "$tsb" ] || bad "a java rule change moved the typescript id"

if [ "$fail" -eq 0 ]; then echo "engine-id: ok (path-independent, rule-sensitive, no souffle needed)"; else echo "engine-id: $fail failure(s)"; exit 1; fi
