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

