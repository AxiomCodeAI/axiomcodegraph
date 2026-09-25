#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The query programs answer the same compiled as interpreted, on every platform.
#
#   query-smoke.sh expect <gen-queries-dir>              (generate job, with Soufflé)
#   query-smoke.sh check  <gen-queries-dir> <bin-dir>    (each platform, no Soufflé)
#
# `expect` writes a small call graph as facts (fixture/) and what the Soufflé
# interpreter derives from it for every <name>.dl (expected/<name>/). `check` runs
# each platform's axiomcode-query-<name> on the same facts and compares, relation
# by relation. Starting on empty inputs would pass a binary that answers nothing;
# this fails one whose answers differ, and fails if the fixture reaches nothing.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
mode="${1:?usage: query-smoke.sh expect|check <gen-queries-dir> [bin-dir]}"; G="${2:?gen-queries-dir}"
EXE=""; case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe";; esac
inputs() { sed -n 's/.*\.input \([A-Za-z0-9_]*\).*/\1/p' "$1"; }
norm() { for f in "$1"/*.csv; do [ -e "$f" ] || continue; printf '== %s\n' "$(basename "$f")"; tr -d '\r' < "$f" | LC_ALL=C sort; done; }

case "$mode" in
  expect)
    F="$G/fixture"; rm -rf "$F"; mkdir -p "$F"
    for dl in "$G"/*.dl; do inputs "$dl" | while read -r r; do : > "$F/$r.facts"; done; done
    # t -> a -> b -> c, and x -> c by name only; one path query from t to c
    printf 'm:t\tm:a\tcall\nm:a\tm:b\tcall\nm:b\tm:c\tcall\n' > "$F/edge.facts"
    printf 't\tm:t\na\tm:a\nb\tm:b\nc\tm:c\nx\tm:x\n' > "$F/named.facts"
    printf 'm:x\tc\n' > "$F/byname.facts"
    printf 'q\tm:t\n' > "$F/src.facts"
    printf 'q\tm:c\n' > "$F/dst.facts"
    # impact: what changing c reaches, through the same chain's resolved call sites
    printf 'q\tmethod\tm:c\tc\n' > "$F/target.facts"
    printf 'm:t\tm:a\tclient\tT.java\t3\nm:a\tm:b\tclient\tA.java\t4\nm:b\tm:c\tclient\tB.java\t5\n' > "$F/calls.facts"
    printf 'm:a\tmethod\nm:b\tmethod\nm:c\tmethod\nm:t\tmethod\n' > "$F/kind.facts"
    for dl in "$G"/*.dl; do
      q="$(basename "$dl" .dl)"; E="$G/expected/$q"; rm -rf "$E"; mkdir -p "$E"
      souffle -F "$F" -D "$E" "$dl"
      n="$(cat "$E"/*.csv 2>/dev/null | wc -l | tr -d ' ')"
      echo "query $q: interpreter derived $n rows"
    done
    for q in impact path; do
      [ "$(cat "$G"/expected/$q/*.csv | wc -l)" -gt 0 ] || { echo "::error::the fixture reaches nothing in $q.dl"; exit 1; }
    done
    ;;
  check)
    B="${3:?bin-dir}"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; bad=0
    for dl in "$G"/*.dl; do
      q="$(basename "$dl" .dl)"; bin="$B/axiomcode-query-$q$EXE"
      [ -f "$bin" ] || { echo "::error::no binary for $q"; bad=1; continue; }
      chmod +x "$bin" 2>/dev/null || true
      mkdir -p "$W/$q"; "$bin" -F "$G/fixture" -D "$W/$q"
      if diff <(norm "$G/expected/$q") <(norm "$W/$q") > "$W/$q.diff"; then
        echo "query $q: ok ($(norm "$W/$q" | grep -vc '^==') rows, same as the interpreter)"
      else
        echo "::error::query $q: the compiled program answers differently"; head -40 "$W/$q.diff"; bad=1
      fi
    done
    exit "$bad"
    ;;
  *) echo "unknown mode $mode" >&2; exit 2;;
esac
