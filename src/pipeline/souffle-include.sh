# ─────────────────────────────────────────────────────────────────────────────
# Where soufflé's C++ headers are. Source this; it defines find_souffle_include.
#
# Separate from run-souffle.sh so it can be tested: this resolution silently produced a path that
# only compiled on the machine it was written on, and nothing could assert otherwise while it was
# inlined in a script that runs the whole pipeline. See test/tools/souffle-include-test.sh.
# ─────────────────────────────────────────────────────────────────────────────

# Soufflé's C++ headers. DERIVED, never hardcoded — the path is version- and
# platform-specific (Homebrew ARM vs Intel vs Linux), so pinning one Cellar path makes the
# engine unbuildable everywhere else. Resolve the binary, walk to its prefix, then fall back.
# Override with AXIOM_SOUFFLE_INCLUDE if souffle lives somewhere unusual.
# WHICH directory under a prefix is the -I. Soufflé's generated C++ includes its headers as
# `souffle/CompiledSouffle.h`, so the -I must be the directory CONTAINING souffle/ — and which one
# that is DIFFERS BY INSTALLATION, so it has to be probed rather than assumed:
#
#   * Homebrew installs the headers TWICE. include/souffle/souffle/ is a real second copy (not a
#     symlink), so there the -I is include/souffle.
#   * a source build or a distro package installs them once, at include/souffle/*.h, so there the
#     -I is include.
#
# Getting it wrong is not a warning. On a standard layout `-I include/souffle` cannot find
# CompiledSouffle.h at all; on Homebrew `-I include` reaches both copies and every header is
# double-defined ("redefinition of 'isRamType'"). Testing `-d "$p/include/souffle"` cannot choose,
# because that directory exists on BOTH layouts — which is why this resolved one level too deep and
# the engine still compiled on the machine it was written on. Probe for the FILE the compiler will
# actually open. See issue #216.
souffle_include_under(){
  local c
  for c in "$1/include/souffle" "$1/include"; do
    [ -f "$c/souffle/CompiledSouffle.h" ] && { echo "$c"; return 0; }
  done
  return 1
}
find_souffle_include(){
  local b p
  [ -n "${AXIOM_SOUFFLE_INCLUDE:-}" ] && { echo "$AXIOM_SOUFFLE_INCLUDE"; return; }
  b="$(command -v souffle 2>/dev/null)" || true
  if [ -n "$b" ]; then
    # Resolve symlinks WITHOUT depending on an interpreter or GNU coreutils:
    # readlink -f where supported (GNU, and macOS 12.3+), else walk the links by hand.
    r="$(readlink -f "$b" 2>/dev/null)" || r=""
    if [ -z "$r" ]; then
      r="$b"; while [ -L "$r" ]; do
        t="$(readlink "$r")"
        case "$t" in /*) r="$t";; *) r="$(dirname "$r")/$t";; esac
      done
    fi
    p="$(cd "$(dirname "$r")/.." && pwd)"
    souffle_include_under "$p" && return
  fi
  for p in "$(brew --prefix souffle 2>/dev/null)" /usr/local /usr /opt/homebrew; do
    [ -n "$p" ] && souffle_include_under "$p" && return
  done
}
