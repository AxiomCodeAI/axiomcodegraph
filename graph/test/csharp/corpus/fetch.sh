#!/bin/bash
# Clone the C# corpus defined by corpus.tsv, at the PINNED commits.
#
# Nothing here is scored and nothing is installed into this repository. A C#
# subject needs no dependency install to be measured: the engine is run
# client-only and the oracle compiles against reference assemblies only, so the
# source tree alone is the whole subject. That is a real simplification over the
# TypeScript corpus, which has to npm-install every member before it can be read.
#
# NOT /tmp. The TypeScript corpus lost all nine projects' source mid-session to the
# system's /tmp reaper, with the directories left standing and .git gone, and it
# surfaced as four unrelated-looking harness failures. Override with CS_CORPUS.
set -u
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${CS_CORPUS:-$HOME/.cache/axiom-cs-corpus}"
mkdir -p "$ROOT"

# The loop is the body of a PIPELINE and runs in a subshell, so a variable set
# inside it does not survive. Failures go to a file instead.
FAILED="$ROOT/.pin-failures"
rm -f "$FAILED"

while IFS=$'\t' read -r name set path repo commit note; do
  case "$name" in '#'*|'') continue ;; esac
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  d="$ROOT/$name"
  if [ ! -d "$d/.git" ]; then
    echo "▶ $name: cloning $repo"
    rm -rf "$d"
    # A SHORT OR FULL SHA IS NOT A REF github WILL SERVE:
    #   git fetch --depth 1 origin <sha>  -> upload-pack: not our ref
    # (uploadpack.allowReachableSHA1InWant is off there). So the default branch is
    # cloned with enough history to reach the pin, and the pin is then checked out.
    # Fetching the sha directly and falling back to the default branch is what let a
    # TypeScript pin silently drift: it only held while upstream HEAD happened to
    # still be it, and two of four members had already moved.
    if ! git clone --quiet --filter=blob:none --no-checkout "$repo" "$d" 2>/dev/null; then
      echo "  !! clone failed"; echo "$name clone" >> "$FAILED"; continue
    fi
  fi
  if ! git -C "$d" cat-file -e "$commit^{commit}" 2>/dev/null; then
    git -C "$d" fetch --quiet origin 2>/dev/null || true
  fi
  if ! git -C "$d" checkout --quiet --detach "$commit" 2>/dev/null; then
    echo "  !! $name: pinned commit $commit is not reachable"
    echo "$name pin $commit" >> "$FAILED"
    continue
  fi
  have="$(git -C "$d" rev-parse HEAD)"
  if [ "$have" != "$commit" ]; then
    echo "  !! $name: checked out $have, wanted $commit"
    echo "$name mismatch $have" >> "$FAILED"
    continue
  fi
  if [ ! -d "$d/$path" ]; then
    echo "  !! $name: path $path does not exist at this commit"
    echo "$name path $path" >> "$FAILED"
    continue
  fi
  n=$(find "$d/$path" -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' | wc -l | tr -d ' ')
  echo "  $name [$set] $path — $n .cs files at ${commit:0:8}"
done < "$HERE/corpus.tsv"

if [ -s "$FAILED" ]; then
  echo
  echo "!! $(wc -l < "$FAILED" | tr -d ' ') corpus member(s) did not provision:"
  cat "$FAILED"
  echo "A member that cannot be provisioned is BLOCKED, not absent: fix it or mark it"
  echo "in corpus.tsv with the reason. A manifest that silently drops what it cannot"
  echo "measure is how a held-out set comes to be three projects none of which work."
  exit 1
fi
echo
echo "corpus at $ROOT"
