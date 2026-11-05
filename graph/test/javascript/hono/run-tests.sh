#!/usr/bin/env bash
# axiom-code-graph: Hono torture suites, JavaScript twin.
# The same runner, oracle and compare as graph/test/typescript/hono (see its header), over this
# directory's cases/ and expected/, solved with the JavaScript engine. The oracle reads .js/.mjs/.cjs
# with allowJs, so the truth comes from the same compiler and the same pinned hono.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HONO_LANG=javascript HONO_SUITE_DIR="$HERE" exec bash "$HERE/../../typescript/hono/run-tests.sh" "$@"
