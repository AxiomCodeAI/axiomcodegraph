#!/bin/bash
# Library-staging predicates, kept sourceable so they can be tested without running the
# whole pipeline. run-evaluation.sh sources this; fixtures/multi-program/run.sh sources it
# too and asserts against a synthetic dependency tree.
#
# Nothing here invokes the parser or writes anything. They answer two questions:
#   lib_programs  <dir>            which sub-directories are SIBLING programs worth staging
#   lib_shortfall <ir> <parserlog> did the parser publish fewer modules than it analysed

lib_programs() { # $1 = package dir -> relative sub-program dirs that hold TypeScript
  local src="$1" d
  find "$src" -mindepth 2 -name node_modules -prune -o \
       -type f \( -name package.json -o -name tsconfig.json \) -print 2>/dev/null \
    | sed "s|/[^/]*\$||" | sort -u | while IFS= read -r d; do
      # A sub-directory with no TypeScript beneath it is not a program worth staging.
      [ -n "$(find "$d" -name node_modules -prune -o \
                 \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \) \
                 -print -quit 2>/dev/null)" ] || continue
      printf '%s\n' "${d#$src/}"
    done
}

# Parsed count vs published count. The shortfall is the whole signal for #230.
lib_shortfall() { # $1 = ir dir, $2 = parser log -> prints "analysed published" or nothing
  local published analysed
  [ -s "$1/all-typescript-modules.csv" ] || return 1
  published=$(( $(wc -l < "$1/all-typescript-modules.csv") - 1 ))
  analysed=$(grep -oE 'TypeScript files analysed: *[0-9]+' "$2" 2>/dev/null \
             | grep -oE '[0-9]+' | tail -1)
  [ -n "$analysed" ] || return 1
  printf '%s %s\n' "$analysed" "$published"
}


# ── is_project_itself <dir> <project-root> <mirror-root> ─────────────────────
# THE PACKAGE UNDER ANALYSIS, REACHED A SECOND WAY.
#
# In a workspace `node_modules/<own-name>` is a symlink back to the package being
# analysed, so library discovery finds it exactly like any other dependency and stages
# it. The mirror and the staged copy are then the same source under two roots, and the
# scorer — correctly — treats them as two declarations. Every site whose target lives
# in the project answers twice:
#
#     SOUND_SUPERSET  helper  lib.ts:1:1   lib.ts:1:1;lib.ts:1:1
#
# One declaration, two answers, and the site is hedged instead of exact. Measured on a
# workspace built to have exactly this shape, with nothing else changed:
#
#     staged   exactness 0.200   decisiveness 0.200
#     skipped  exactness 0.800   decisiveness 1.000
#
# This is NOT the #118 shape and that guard cannot fire here: `src_duplicates_staged_subdir`
# asks whether a directory is a second copy INSIDE a staged package. This duplicate is
# not inside anything — it IS the package, reached under another path. So the test is
# identity of the RESOLVED directory, the only thing the two paths share.
#
# Both roots are checked because they are different absolute paths: the node_modules
# search runs over the ORIGINAL tree while the analysed sources are the mirror, and a
# self-link resolves to the former. See #231.
is_same_dir() { # $1 $2 -> 0 when both resolve to the same real directory
  local a b
  a="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  b="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
  [ -n "$a" ] && [ "$a" = "$b" ]
}

is_project_itself() { # $1 = candidate dir, $2 = project root, $3 = mirror root
  local cand="$1" proj="${2:-}" mirror="${3:-}"
  [ -n "$cand" ] || return 1
  [ -n "$proj" ]   && is_same_dir "$cand" "$proj"   && return 0
  [ -n "$mirror" ] && is_same_dir "$cand" "$mirror" && return 0
  return 1
}
