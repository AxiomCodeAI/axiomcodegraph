# ─────────────────────────────────────────────────────────────────────────────
# The library-facts cache key. Source this after portable-stat.sh; it defines lib_cache_key.
#
# The staged library facts depend ONLY on which modules are staged, what they contain, and
# the LIB_SIG relation list. The key therefore hashes, per module, its BASENAME (so
# `java.base` and `java.sql` stay distinct, and a module added or removed still changes the
# key) plus the identity of each of its CSVs (basename, size, mtime). It does NOT hash the
# --library string or the module's full path: the same 63 platform modules reached as
# `$JDK_IR/java.base` and as `$WORK/libroot/java.base` (a symlink farm) are one library and
# must share one staged copy. Keyed on paths they got two, 473 MB each, once per caller that
# assembled the root at a new path, until a disk filled (#588).
#
#   lib_cache_key <lib-sig-list> <root>...
#
# Each root is one IR root: a directory holding the marker table directly, or module
# sub-directories that do. lib_modules must be defined by the caller (it knows IR_MARKER).
# ─────────────────────────────────────────────────────────────────────────────
lib_cache_key(){
  local sig="$1"; shift
  { printf 'sig %s\n' "$sig"
    local root mod
    for root in "$@"; do
      while IFS= read -r mod; do
        [ -n "$mod" ] || continue
        # The module's NAME is part of the key on its own. Metadata can come back empty for
        # reasons that have nothing to do with the library's content, and when it does the key
        # must still change if a module was added or removed.
        printf 'module %s\n' "$(basename "$mod")"
        # -L BECAUSE A MODULE IS ROUTINELY A SYMLINK: find does not descend a symlinked operand
        # without it, and a root assembled from links then contributed NO file metadata at all.
        # size+mtime of each CSV, by basename: cheap, and changes whenever the IR does.
        # file_ident, NOT `stat -f ... || stat -c ...`: see portable-stat.sh.
        find -L "$mod" -maxdepth 1 -name '*.csv' -exec stat "$_STAT_IDENT" {} + 2>/dev/null \
          | while IFS= read -r line; do
              # "<path> <size> <mtime>" -> "<basename> <size> <mtime>"
              local name="${line% * *}"; local rest="${line#"$name"}"
              printf 'file %s%s\n' "$(basename "$name")" "$rest"
            done
      done < <(lib_modules "$root")
    done
  } | sort | sha1_stdin
}
