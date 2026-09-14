#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The library-facts cache key, and the two parser-staleness guards, are built from file
# metadata. Nothing checked that the metadata read actually worked, and it did not: on GNU
# coreutils `stat -f FMT` is --file-system, so the key was computed from filesystem free-block
# counters and the guards compared a filesystem report against an epoch. Both failed silently,
# and a false cache hit does not present as staleness — it presents as an engine regression,
# because the run is answered from a library IR that is no longer on disk.
#
# So the key is CHECKED here rather than trusted. This is language-independent, cheap, and runs
# as a preflight: a wrong key makes every other number in the suite untrustworthy.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/graph/pipeline/portable-stat.sh"

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; checks=0
# Quiet on success — this is a preflight, and nine green lines ahead of every suite run is noise
# that gets scrolled past. Set PORTABLE_STAT_VERBOSE=1 to see each check.
ok(){   checks=$((checks+1)); [ -n "${PORTABLE_STAT_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# The same computation run-souffle.sh's lib_cache_key performs over one module.
key_of(){ find -L "$1" -maxdepth 1 -name '*.csv' -exec stat "$_STAT_IDENT" {} + 2>/dev/null | sort | sha1_stdin; }

mkdir -p "$W/mod"
printf 'a\tb\n1\t2\n' > "$W/mod/all-types.csv"
printf 'x\ty\n3\t4\n' > "$W/mod/all-methods.csv"

# ── the metadata read itself ─────────────────────────────────────────────────
t="$(file_mtime "$W/mod/all-types.csv")" || t=""
case "$t" in ''|*[!0-9]*) bad "file_mtime returned a non-number ('$t')";; *) ok "file_mtime reads an epoch";; esac

if m="$(file_mtime "$W/nonexistent")"; then bad "file_mtime succeeded on a missing file"
elif [ -n "$m" ];                      then bad "file_mtime printed '$m' for a missing file"
else                                        ok "file_mtime fails silently on a missing file"; fi

ident="$(file_ident "$W/mod/all-types.csv")"
case "$ident" in
  *Blocks:*|*Inodes:*|*Namelen:*) bad "file_ident returned a FILESYSTEM report, not file metadata: $ident";;
  *) set -- $ident
     if [ "$#" -ne 3 ]; then bad "file_ident wants '<name> <size> <mtime>', got: $ident"
     else case "$2$3" in *[!0-9]*) bad "file_ident size/mtime are not numeric: $ident";;
                         *) ok "file_ident reads name, size and mtime";; esac; fi;;
esac

d="$(printf 'x' | sha1_stdin)" || d=""
case "$d" in [0-9a-f]*) [ "${#d}" -eq 40 ] && ok "sha1_stdin returns a 40-char digest" \
                                           || bad "sha1_stdin digest is ${#d} chars: '$d'";;
             *) bad "sha1_stdin produced no digest ('$d')";; esac

# ── the cache key, which is what all of that is for ──────────────────────────
k1="$(key_of "$W/mod")"
k2="$(key_of "$W/mod")"
[ "$k1" = "$k2" ] && ok "key is stable when the IR is unchanged" \
                  || bad "key moved with no change to the IR ($k1 -> $k2)"

# A rebuilt IR at the SAME path is exactly what build-jdk-ir.sh produces, so this is the case
# that matters: different content, same size.
sleep 1
printf 'a\tb\n9\t8\n' > "$W/mod/all-types.csv"
k3="$(key_of "$W/mod")"
[ "$k1" != "$k3" ] && ok "key changes when a library IR is rebuilt in place" \
                   || bad "REBUILT IR REUSES THE KEY ($k1) — stale facts would be served"

# The key must not depend on anything outside the IR. Free space is what the broken form hashed.
k4="$(key_of "$W/mod")"
dd if=/dev/zero of="$W/ballast" bs=1m count=64 2>/dev/null || dd if=/dev/zero of="$W/ballast" bs=1M count=64 2>/dev/null
k5="$(key_of "$W/mod")"; rm -f "$W/ballast"
[ "$k4" = "$k5" ] && ok "key ignores unrelated filesystem free space" \
                  || bad "key moved when only free space did ($k4 -> $k5) — spurious re-stage of the whole library"

# ── a SYMLINKED module is a module ───────────────────────────────────────────
# A library root is routinely assembled from symlinks, one per module — that is how the torture
# harness stages the stub plus 63 platform modules. Without find -L each of those contributed no
# metadata at all, so the key was a function of the (fixed) root path and swapping the platform IR
# in or out behind the links did not move it.
mkdir -p "$W/real" "$W/root"
printf 'a\tb\n1\t2\n' > "$W/real/all-types.csv"
ln -sfn "$W/real" "$W/root/mod1"
s1="$(key_of "$W/root/mod1")"
sleep 1
printf 'a\tb\n9\t8\n' > "$W/real/all-types.csv"
s2="$(key_of "$W/root/mod1")"
if [ "$s1" = "$(printf '' | sha1_stdin)" ]; then
  bad "a symlinked module contributed NO metadata — the key would ignore it entirely"
elif [ "$s1" = "$s2" ]; then
  bad "key ignored a rebuild behind a SYMLINKED module ($s1)"
else
  ok "key tracks a module reached through a symlink"
fi

# ── and nobody may go back to the unportable form ────────────────────────────
# `stat -f`/`stat -c` are what this file exists to keep out of the tree: both spellings are
# correct on one platform and silently wrong on the other.
strays="$(grep -rn --include='*.sh' -E '(^|[^_[:alnum:]])stat[[:space:]]+-[fc][[:space:]]' "$ROOT/src" "$ROOT/test" 2>/dev/null \
          | grep -v 'portable-stat' || true)"
[ -z "$strays" ] && ok "no script calls stat -f / stat -c directly" \
                 || { bad "these must use file_mtime/file_ident from graph/pipeline/portable-stat.sh:"; echo "$strays" | sed 's/^/          /'; }

[ "$fail" = 0 ] && echo "portable-stat: ok ($checks checks)" || echo "portable-stat: FAILED"
exit "$fail"
