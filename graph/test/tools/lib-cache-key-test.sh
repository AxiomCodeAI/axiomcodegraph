#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The library-facts cache key is a function of the staged modules' CONTENT identity, not of
# the path they were reached by (#588). Asserted:
#   1. the same modules reached as a real root and as a symlink farm at another path key alike
#   2. the --library string and the root path are not in the key (a copy of the root keys alike)
#   3. a module added, removed or renamed changes the key
#   4. a CSV rewritten changes the key; the LIB_SIG list is in the key
#   5. a flat IR root (marker table directly) keys like the module form of the same content
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
. "$ROOT/graph/pipeline/portable-stat.sh"
. "$ROOT/graph/pipeline/lib-cache-key.sh"
IR_MARKER="all-types.csv"
lib_modules(){ if [ -f "$1/$IR_MARKER" ]; then printf '%s\n' "$1"; else for m in "$1"/*/; do [ -d "$m" ] && printf '%s\n' "${m%/}"; done; fi; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
mkdir -p "$W/jdk/java.base" "$W/jdk/java.sql"
printf 'a\tb\n1\t2\n' > "$W/jdk/java.base/all-types.csv"; printf 'x\ty\n3\t4\n' > "$W/jdk/java.base/all-methods.csv"
printf 'a\tb\n5\t6\n' > "$W/jdk/java.sql/all-types.csv"
SIG="java_type java_method"
k_real="$(lib_cache_key "$SIG" "$W/jdk")"
# 1. a symlink farm reaching the same modules
mkdir -p "$W/farm/libroot"; ln -s "$W/jdk/java.base" "$W/farm/libroot/java.base"; ln -s "$W/jdk/java.sql" "$W/farm/libroot/java.sql"
k_farm="$(lib_cache_key "$SIG" "$W/farm/libroot")"
[ "$k_real" = "$k_farm" ] || bad "a symlink farm of the same modules keyed differently ($k_real vs $k_farm)"
# 2. a copy at another path with the same mtimes
mkdir -p "$W/copy"; cp -Rp "$W/jdk" "$W/copy/jdk"
k_copy="$(lib_cache_key "$SIG" "$W/copy/jdk")"
[ "$k_real" = "$k_copy" ] || bad "a copy of the root at another path keyed differently"
# 3. a module added, removed, renamed
mkdir -p "$W/jdk/java.net"; printf 'a\tb\n7\t8\n' > "$W/jdk/java.net/all-types.csv"
k_added="$(lib_cache_key "$SIG" "$W/jdk")"; [ "$k_added" != "$k_real" ] || bad "adding a module left the key unchanged"
rm -rf "$W/jdk/java.net"
[ "$(lib_cache_key "$SIG" "$W/jdk")" = "$k_real" ] || bad "removing the module again did not restore the key"
mv "$W/jdk/java.sql" "$W/jdk/java.sqlx"
[ "$(lib_cache_key "$SIG" "$W/jdk")" != "$k_real" ] || bad "renaming a module left the key unchanged"
mv "$W/jdk/java.sqlx" "$W/jdk/java.sql"
# 4. a CSV rewritten (size changes); the signature list
printf 'a\tb\n1\t2\n9\t9\n' > "$W/jdk/java.base/all-types.csv"
[ "$(lib_cache_key "$SIG" "$W/jdk")" != "$k_real" ] || bad "rewriting a CSV left the key unchanged"
printf 'a\tb\n1\t2\n' > "$W/jdk/java.base/all-types.csv"; touch -r "$W/copy/jdk/java.base/all-types.csv" "$W/jdk/java.base/all-types.csv"
[ "$(lib_cache_key "$SIG" "$W/jdk")" = "$k_real" ] || bad "restoring the CSV did not restore the key"
[ "$(lib_cache_key "java_type" "$W/jdk")" != "$k_real" ] || bad "a different LIB_SIG list keyed alike"
# 5. two roots naming the same modules twice stage twice, so they key apart from one root
[ "$(lib_cache_key "$SIG" "$W/jdk" "$W/farm/libroot")" != "$k_real" ] || bad "a root listed twice keyed like one root"
# the key is a digest
case "$k_real" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) bad "the key is not a digest: '$k_real'";; esac
[ $fail = 0 ] && echo "lib-cache-key-test: ok" || { echo "lib-cache-key-test: $fail failure(s)"; exit 1; }
