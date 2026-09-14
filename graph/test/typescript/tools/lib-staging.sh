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

# ── link_into_mirror <source> <link-path> <project-root> <mirror-root> ───────
# A SELF-LINK MUST POINT AT THE MIRROR, NOT BACK OUT OF IT.
#
# The mirror gets a directory of per-package symlinks into the ORIGINAL node_modules
# roots. For an ordinary dependency that is right — there is only one copy of it. For a
# workspace SELF-LINK it is not: `node_modules/<own-name>` resolves to the package being
# analysed, so the link led back out of the mirror. TypeScript resolves symlinks to
# their realpath, so a file importing its own package by name was adjudicated against
# the ORIGINAL tree while the engine's IR is the mirror:
#
#     src/selfref.ts  helper()
#         oracle  <original>/packages/wsp/src/lib.ts:1:1
#         engine  <mirror>/project/src/lib.ts:1:1
#
# Same file, same line, same column, different root, so the two cannot join and the site
# scores WRONG while both sides named the same declaration. Measured on a workspace built
# to that shape, with nothing else changed:
#
#     self-link -> original    exactness 0.800   1 WRONG
#     self-link -> mirror      exactness 1.000   0 WRONG
#
# Invisible until #231: the project was ALSO staged as its own dependency from the
# original tree, so an original-rooted answer was in the engine's set and the site read
# SOUND_SUPERSET. Removing that duplicate revealed the mismatch. See #293.
link_into_mirror() { # $1 = source, $2 = link path, $3 = project root, $4 = mirror root
  local target="$1"
  [ -e "$2" ] && return 0
  if is_project_itself "$target" "${3:-}" "${4:-}"; then
    target="${4:-$1}"
  fi
  ln -sfn "$target" "$2"
}

# ── find_in_nm <relative-path> ──────────────────────────────────────────────
# Searches the NM_ROOTS array — every node_modules up the chain, nearest first — and
# echoes the first hit. Reads the array rather than taking it as arguments so the call
# sites stay short; the caller populates NM_ROOTS before the first call.
#
# THE ARRAY IS THE POINT. This was a space-delimited string iterated unquoted, so a
# checkout whose path contained a space was indistinguishable from two checkouts and
# every lookup through the fragments missed — no standard library, no @types, no
# dependencies staged, and a score still printed against an empty global scope. See
# issue #296.
find_in_nm() { # $1 = path relative to a node_modules root -> echoes the first match
  local r
  for r in ${NM_ROOTS[@]+"${NM_ROOTS[@]}"}; do
    [ -e "$r/$1" ] && { echo "$r/$1"; return 0; }
  done
  return 1
}
