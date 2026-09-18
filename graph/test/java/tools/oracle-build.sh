#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Compile ClassFileOracle.java, and say how to RUN it. Issue #911.
#
# java.lang.classfile (JEP 484) is final in JDK 24 and PREVIEW in 22 and 23. Every
# caller used to compile with a bare `javac` and SKIP on failure, so on a JDK 23 the
# whole ground-truth layer went dark: the bytecode oracle, the oracle-agreement pin
# between the two readers, and the torture harness. A green suite on such a machine
# proves NO REGRESSION and nothing about correctness, while its output looks like it
# proves both.
#
# It is not that the oracle cannot run on those JDKs. Two flags are enough, and a
# preview-compiled class also needs the flag at RUN time, which is why this prints the
# runtime flags rather than only compiling.
#
#   oracle_build <out-dir> [log-file]   -> compiles, echoes the java flags, rc 0
#                                          rc 1 and a diagnostic if neither way works
# ─────────────────────────────────────────────────────────────────────────────
oracle_build(){
  local out="$1" log="${2:-/dev/null}" here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  mkdir -p "$out"
  # The plain way first: on JDK 24+ this is all it takes and the class needs no flags.
  if javac -d "$out" "$here/ClassFileOracle.java" 2>>"$log"; then
    printf '%s' ""
    return 0
  fi
  # PREVIEW. --release must name the running compiler's own feature version: preview
  # APIs are only available for the exact release that is previewing them.
  local ver
  ver="$(javac -version 2>&1 | sed -n 's/^javac \([0-9][0-9]*\).*/\1/p')"
  if [ -n "$ver" ] && javac --enable-preview --release "$ver" -d "$out" "$here/ClassFileOracle.java" 2>>"$log"; then
    printf '%s' "--enable-preview"
    return 0
  fi
  echo "ClassFileOracle does not compile on this JDK (javac ${ver:-unknown}); java.lang.classfile needs JDK 22+ (preview) or 24+ (final)" >&2
  return 1
}
