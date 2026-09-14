#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WHERE IS A `typescript` THIS MACHINE CAN STAGE?
#
# Every fixture needs one: it symlinks `typescript/lib` into the fixture project so the
# global scope is populated, and without it a call on a string, an array or a promise
# resolves to nothing. Each fixture answered that question the same way — with an
# absolute path inside ONE developer's home directory as the default for its second
# argument:
#
#     NM="${2:-/Users/<a developer>/Documents/<...>/node_modules}"
#
# and `run-tests.sh` never passed the argument. So on any other machine the directory
# does not exist, the `&&` guarding the symlink swallows it silently, and the mandatory
# baseline fails with three assertions that read as engine defects in native and global
# resolution rather than as a missing argument. See #331.
#
# Asked once, here, so there is one answer and one place to change it. Prints the
# directory on stdout and exits 0; prints nothing and exits 1 when there is none, which
# lets a caller SKIP loudly rather than fail obscurely.
#
# Order matters: an explicit override wins, then the parser's own tree — the parser and
# the oracle must agree about which TypeScript they are describing (#239) — then the
# repository's, then a corpus checkout's.
# ─────────────────────────────────────────────────────────────────────────────
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"  # the repository root, found by its marker — no level counting

for c in "${TS_NODE_MODULES:-}" \
         "${TS_MODULE_PATH:+$(dirname "$TS_MODULE_PATH")}" \
         "${AXIOM_PARSER:+$(dirname "$(dirname "$AXIOM_PARSER")")/node_modules}" \
         "$REPO/node_modules" \
         "$HOME/.cache/axiom-ts-corpus/immer/node_modules"; do
  [ -n "$c" ] && [ -d "$c/typescript" ] && { echo "$c"; exit 0; }
done
exit 1
