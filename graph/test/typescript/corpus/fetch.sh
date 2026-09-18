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
# The loop below is the body of a PIPELINE, so it runs in a subshell and a shell
# variable set inside it does not survive. Failures are recorded in a file instead.
FAILED_LIST="$ROOT/.pin-failures"
rm -f "$FAILED_LIST"

grep -v '^#' "$HERE/corpus.tsv" | grep -v '^[[:space:]]*$' | while read -r name set path repo commit note; do
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  d="$ROOT/$name"
  if [ ! -d "$d/.git" ]; then
    echo "▶ $name: cloning $repo @ $commit"
    # A SHORT SHA IS NOT A REF A SERVER WILL SERVE, and the full one is refused too:
    #   git fetch --depth 1 origin 061c242    -> couldn't find remote ref 061c242
    #   git fetch --depth 1 origin 061c2427…  -> upload-pack: not our ref
    # (github.com does not enable uploadpack.allowReachableSHA1InWant). The old code
    # fetched "$commit" directly and fell back to a shallow clone of the DEFAULT
    # BRANCH, so a pin only ever held while upstream HEAD happened to still be it --
    # and two of four members had already drifted without anyone noticing.
    #
    # So: fetch the branch shallow and DEEPEN until the pinned object is present.
    git init -q "$d"
    ( cd "$d" && git remote add origin "$repo" && git fetch -q --depth 50 origin ) || true
    depth=50
    while [ "$depth" -le 6400 ]; do
      if ( cd "$d" && git cat-file -e "${commit}^{commit}" 2>/dev/null ); then break; fi
      depth=$((depth * 2))
      ( cd "$d" && git fetch -q --depth "$depth" origin ) || break
    done
    if ( cd "$d" && git cat-file -e "${commit}^{commit}" 2>/dev/null ); then
      ( cd "$d" && git checkout -q "$commit" )
    else
      # A member that cannot be placed at its pin is BLOCKED, not silently measured at
      # whatever upstream happens to be today. corpus.tsv already has that vocabulary.
      echo "  ! $name: PIN $commit NOT REACHABLE after deepening to $depth — leaving unusable"
      echo "  ! $name: mark it blocked in corpus.tsv, or update the pin deliberately"
      rm -rf "$d"
      echo "$name" >> "$FAILED_LIST"
      continue
    fi
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
    # THE PROJECT'S OWN PACKAGE MANAGER, through corepack, which ships with node and
    # honours the `packageManager` field. The old fallback ran npm with
    # --legacy-peer-deps wherever pnpm was not already on PATH, and that is not a
    # slower install of the same tree: it is a different one. Measured on the pnpm
    # subject, whose peer `@testing-library/dom` npm then leaves out, so all 13 of its
    # test files fail to collect. With corepack the same checkout is 13 passed and 224
    # passed, which is the figure the oracle was built against.
    #
    # --ignore-scripts STAYS. It is the reason this is safe to run over nine cloned
    # repositories, and the static evaluation never executes anything. A harness that
    # needs the subject to RUN checks that for itself now, and says so: see
    # runtime-oracle/trace-subject.sh, which takes a baseline before it instruments.
    ( cd "$d"
      if [ -f pnpm-lock.yaml ]; then
        corepack pnpm install --ignore-scripts --silent >/dev/null 2>&1 \
          || pnpm install --ignore-scripts --silent >/dev/null 2>&1 \
          || npm install --silent --ignore-scripts --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
      elif [ -f yarn.lock ]; then
        corepack yarn install --ignore-scripts --silent >/dev/null 2>&1 \
          || npm install --silent --ignore-scripts --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
      else
        npm install --silent --ignore-scripts --no-audit --no-fund >/dev/null 2>&1 \
          || npm install --silent --ignore-scripts --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
      fi )
    echo "  $name: node_modules=$([ -d "$d/node_modules" ] && echo yes || echo NONE)"
  fi
done
if [ -s "$FAILED_LIST" ]; then
  echo "CORPUS INCOMPLETE at $ROOT — could not place at their pins: $(tr '\n' ' ' < "$FAILED_LIST")" >&2
  exit 1
fi
echo "CORPUS READY at $ROOT"
