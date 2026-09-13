# ─────────────────────────────────────────────────────────────────────────────
# Portable file metadata. Source this; it defines file_mtime, file_ident and sha1_stdin.
#
# stat(1) is not portable, and the usual `BSD form || GNU form` fallback is WORSE than either
# form alone, because it reads the wrong thing while looking like it worked.
#
# BSD/macOS spells the format `-f FMT`. GNU coreutils spells it `-c FMT` and uses `-f` for
# --file-system, which takes NO format argument. So on GNU, `stat -f '%N %z %m' FILE` parses the
# format as a FILENAME (which fails, to stderr) and prints a FILESYSTEM report for FILE — block
# and inode counters — on STDOUT. Branching on the exit status cannot repair that:
#
#   * inside `find -exec`, find exits 0 whether or not the command it exec'd failed, so the `||`
#     fallback is never reached at all and the free-block counters are what gets used;
#   * in `X=$(stat -f %m F 2>/dev/null || stat -c %Y F)` the fallback DOES run, but the GNU output
#     is already in the capture, so X is a filesystem report with a number stuck on the end, and
#     every numeric test on it exits 2 — which makes a guard pass for every input, silently.
#
# Decide ONCE instead, by asking stat which spelling it understands, and never look at the exit
# status of a stat that may already have written to the stream being captured.
#
# See src/pipeline/run-souffle.sh (lib_cache_key) and test/java/tools/build-{jdk,lib}-ir.sh.
# test/tools/portable-stat-test.sh asserts the behaviour these callers depend on.
# ─────────────────────────────────────────────────────────────────────────────

if stat -c %Y . >/dev/null 2>&1; then
  _STAT_MTIME='-c%Y'; _STAT_IDENT='-c%n %s %Y'      # GNU coreutils
else
  _STAT_MTIME='-f%m'; _STAT_IDENT='-f%N %z %m'      # BSD / macOS
fi

# mtime of one file, epoch seconds. Prints NOTHING and returns 1 when it cannot be read, so a
# caller can tell "no answer" from a number instead of comparing against whatever came back.
file_mtime(){
  local t
  t="$(stat "$_STAT_MTIME" "$1" 2>/dev/null)" || return 1
  case "$t" in ''|*[!0-9]*) return 1;; esac
  printf '%s\n' "$t"
}

# "<name> <size> <mtime>" per argument — the per-file identity the library-facts cache key is
# built from. Deliberately NOT a content hash: this cache exists to avoid reading the gigabytes
# it keys, so hashing them would defeat its only purpose.
file_ident(){ [ "$#" -gt 0 ] || return 0; stat "$_STAT_IDENT" "$@" 2>/dev/null; }

# sha1 of stdin, digest only. `shasum` is a perl script and is absent from minimal Linux images;
# `sha1sum` is absent from macOS. Pick whichever exists — and if neither does, say so rather than
# return an empty digest, which would silently collapse every distinct input onto one cache key.
if command -v shasum >/dev/null 2>&1;   then _SHA1_CMD=shasum
elif command -v sha1sum >/dev/null 2>&1; then _SHA1_CMD=sha1sum
else _SHA1_CMD=""; fi
sha1_stdin(){
  [ -n "$_SHA1_CMD" ] || { echo "neither shasum nor sha1sum is on PATH" >&2; return 1; }
  "$_SHA1_CMD" | cut -d' ' -f1
}

# sha256 of stdin, for the engine id and for verifying a downloaded binary. Same three
# spellings as sha1 above: `shasum -a 256` (macOS, perl shasum in Git Bash) or `sha256sum`
# (coreutils).
if command -v sha256sum >/dev/null 2>&1;  then _SHA256_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1;   then _SHA256_CMD="shasum -a 256"
else _SHA256_CMD=""; fi
sha256_stdin(){
  [ -n "$_SHA256_CMD" ] || { echo "neither sha256sum nor shasum is on PATH" >&2; return 1; }
  $_SHA256_CMD | cut -d' ' -f1
}
