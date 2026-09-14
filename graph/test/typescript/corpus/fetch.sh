#!/bin/bash
# Clone and install the corpus defined by corpus.tsv, at the PINNED commits.
#
# A shallow clone cannot check out an arbitrary commit, so this fetches the pin
# directly. An unpinned corpus is not a corpus: upstream moves, every previously
# quoted rate becomes unreproducible, and a regression is indistinguishable from
# a dependency bump.
#
# Nothing here is scored. It does not install into the engine repo and it does not
# write outside $TS_CORPUS.
set -u
# --only a,b  provision just these. The blocked members are large and are not measured;
# cloning and installing rxjs, nest and vue-core to run a four-project corpus is minutes
# of network for nothing.
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
# NOT /tmp. Measured the hard way: all nine corpus projects lost every source file
# mid-session to the system's /tmp reaper, directories and node_modules left standing and
# .git gone, which surfaced as four unrelated-looking harness failures. A corpus in /tmp
# is not a corpus. Override with TS_CORPUS.
ROOT="${TS_CORPUS:-$HOME/.cache/axiom-ts-corpus}"
mkdir -p "$ROOT"

grep -v '^#' "$HERE/corpus.tsv" | grep -v '^[[:space:]]*$' | while read -r name set path repo commit note; do
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  d="$ROOT/$name"
  if [ ! -d "$d/.git" ]; then
    echo "▶ $name: cloning $repo @ $commit"
    git init -q "$d"
    ( cd "$d" && git remote add origin "$repo" \
        && git fetch -q --depth 1 origin "$commit" 2>/dev/null \
        && git checkout -q FETCH_HEAD ) \
      || { echo "  ! $name: could not fetch $commit — falling back to default HEAD"
           rm -rf "$d"; git clone -q --depth 1 "$repo" "$d"; }
  fi
  have="$(cd "$d" && git rev-parse --short HEAD 2>/dev/null || echo none)"
  case "$have" in
    "$commit"*) ;;
    *) echo "  ! $name: at $have, corpus.tsv pins $commit — rates are NOT comparable" ;;
  esac

  if [ -d "$d/node_modules" ]; then
    echo "  $name: node_modules present"
  else
    echo "  $name: installing"
    ( cd "$d"
      if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null; then
        pnpm install --ignore-scripts --silent >/dev/null 2>&1 \
          || npm install --silent --ignore-scripts --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
      else
        npm install --silent --ignore-scripts --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
      fi )
    echo "  $name: node_modules=$([ -d "$d/node_modules" ] && echo yes || echo NONE)"
  fi
done
echo "CORPUS READY at $ROOT"
