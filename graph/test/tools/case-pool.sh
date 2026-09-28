# ─────────────────────────────────────────────────────────────────────────────
# Run a suite's per-case loop CONCURRENTLY, and report it exactly as the serial loop did.
# Sourced, not executed.
#
# Every engine suite is one loop over cases/*/, and every case is a separate program: its
# own parse, its own solve, its own oracle, its own work directory. Nearly all of a case's
# few seconds is fixed per-process cost (node, python, the solver starting up), so on a
# machine with several CPUs the serial loop left all but one idle. This runs up to
# AXIOM_SUITE_JOBS cases at a time and prints them as the loop would have:
#
#   * each case's output (stdout and stderr) is captured to its own file and printed IN CASE
#     ORDER, whole, as soon as every case before it has finished — the diagnostics of a
#     failing case read exactly as they did;
#   * the counters the loop body updates (pass/fail and the failed-case list, whatever the
#     suite calls them) are summed in case order, so the summary and the failed list match.
#
# The loop body is not rewritten. A suite wraps it, unchanged, in a one-case `for` so its
# `continue`s keep working:
#
#   case_body() { for dir in "$@"; do  <the old loop body>  done; }
#   POOL_INTS="pass fail" POOL_ARRAYS="failed"      # (and/or POOL_STRINGS for "$X $name" lists)
#   pool_run case_body "$HERE"/cases/*/
#
# WHAT IS NOT SHARED BETWEEN CONCURRENT CASES
#   * the compiled engine: the FIRST case that gets past the suite's filter runs alone, so
#     it compiles (or restores) the engine once; every later case finds it cached. A compile
#     racing another is still safe (run-souffle.sh builds to a temp name and renames), only
#     wasteful, and this keeps it from happening.
#   * the staged library facts: run-souffle.sh caches them under a key made of each module's
#     directory NAME and its CSVs' size and mtime (seconds). Two cases whose library IR sits
#     in a directory of the same name (`$w/libir`) and was parsed in the same second can
#     share a key while holding different rows — impossible when cases run one after
#     another, likely when they run side by side. Each concurrent job therefore stages into
#     its own AXIOM_LIBFACTS_CACHE, so no key is ever shared between them.
#
# AXIOM_SUITE_JOBS=N   at most N cases at once. Default: the number of CPUs.
# AXIOM_SUITE_JOBS=1   the old loop, verbatim: every case runs in this shell, nothing is
#                      captured, nothing is reordered. Use it to debug a case.
# ─────────────────────────────────────────────────────────────────────────────

pool_cpus() {
  local n
  n="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)"
  case "$n" in ''|*[!0-9]*|0) n=1;; esac
  printf '%s\n' "$n"
}

# The concurrency this run will use; suites print it so a log says how it was produced.
pool_jobs() {
  local j="${AXIOM_SUITE_JOBS:-$(pool_cpus)}"
  case "$j" in ''|*[!0-9]*|0) j=1;; esac
  printf '%s\n' "$j"
}

# pool_run <body-fn> <arg>...   runs <body-fn> <arg> for every arg; see the header.
pool_run() {
  local _fn="$1"; shift
  local _jobs; _jobs="$(pool_jobs)"
  if [ "$_jobs" -le 1 ] || [ "$#" -le 1 ]; then
    local _a
    for _a in "$@"; do "$_fn" "$_a"; done
    return 0
  fi

  _POOL_TMP="$(mktemp -d "${TMPDIR:-/tmp}/suite-pool.XXXXXX")" || { echo "pool: no temp dir" >&2; return 1; }
  _POOL_N=$#; _POOL_NEXT=1; _POOL_PIDS=""
  local _i=0 _a _warm=1
  # Background jobs of a non-interactive shell ignore SIGINT, so an interrupted suite would
  # leave its cases running. Stop them, and leave the caller's traps as they were after.
  trap '_pool_abort 130' INT TERM

  for _a in "$@"; do
    _i=$((_i+1))
    _pool_launch "$_fn" "$_i" "$_a"
    if [ "$_warm" = 1 ]; then
      # One at a time until a case has actually run (produced output): that case pays the
      # engine compile, if there is one, before anything runs beside it.
      while [ ! -f "$_POOL_TMP/$_i.done" ]; do sleep 0.1; done
      [ -s "$_POOL_TMP/$_i.out" ] && _warm=0
      _pool_flush
      continue
    fi
    while [ $(( _i - $(_pool_finished) )) -ge "$_jobs" ]; do
      _pool_flush; sleep 0.1
    done
    _pool_flush
  done
  while [ "$_POOL_NEXT" -le "$_POOL_N" ]; do _pool_flush; [ "$_POOL_NEXT" -le "$_POOL_N" ] && sleep 0.1; done
  wait
  trap - INT TERM
  rm -rf "$_POOL_TMP"
  return 0
}

# One case in a background subshell: the counters start at zero there, and whatever the
# body added is written out for _pool_merge. `.done` is written last, after the subshell has
# exited, so a case whose body called `exit` is still noticed (no `.res`).
_pool_launch() {
  local fn="$1" i="$2" arg="$3" d="$_POOL_TMP"
  {
    (
      export AXIOM_LIBFACTS_CACHE="$d/$i.libfacts"
      local v
      for v in ${POOL_INTS:-}; do eval "$v=0"; done
      for v in ${POOL_STRINGS:-}; do eval "$v="; done
      for v in ${POOL_ARRAYS:-}; do eval "$v=()"; done
      "$fn" "$arg"
      {
        for v in ${POOL_INTS:-} ${POOL_STRINGS:-}; do eval "printf 'S\t%s\t%s\n' \"\$v\" \"\${$v}\""; done
        for v in ${POOL_ARRAYS:-}; do
          eval "for _e in \${$v[@]+\"\${$v[@]}\"}; do printf 'A\t%s\t%s\n' \"\$v\" \"\$_e\"; done"
        done
      } > "$d/$i.res.tmp" && mv -f "$d/$i.res.tmp" "$d/$i.res"
    ) > "$d/$i.out" 2>&1
    echo "$?" > "$d/$i.rc"
    rm -rf "$d/$i.libfacts"
    : > "$d/$i.done"
  } &
  _POOL_PIDS="${_POOL_PIDS:-} $!"
}

# How many launched cases have finished (counted by their `.done` marker, not by `jobs`,
# whose view from inside a command substitution differs between bash versions).
_pool_finished() {
  local f n=0
  for f in "$_POOL_TMP"/*.done; do [ -e "$f" ] && n=$((n+1)); done
  printf '%s\n' "$n"
}

# Print, in order, every finished case whose predecessors have all been printed.
_pool_flush() {
  local d="$_POOL_TMP" kind var val v
  while [ "$_POOL_NEXT" -le "$_POOL_N" ] && [ -f "$d/$_POOL_NEXT.done" ]; do
    cat "$d/$_POOL_NEXT.out"
    if [ ! -f "$d/$_POOL_NEXT.res" ]; then
      # The body exited instead of finishing. Serially that ended the suite with its
      # status, so it does here too.
      _pool_abort "$(cat "$d/$_POOL_NEXT.rc" 2>/dev/null || echo 1)"
    fi
    while IFS=$'\t' read -r kind var val; do
      [ "$kind" = A ] && { eval "$var+=(\"\$val\")"; continue; }
      for v in ${POOL_INTS:-}; do
        [ "$v" = "$var" ] && { eval "$var=\$(( $var + $val ))"; continue 2; }
      done
      eval "$var=\"\${$var}\$val\""
    done < "$d/$_POOL_NEXT.res"
    _POOL_NEXT=$((_POOL_NEXT+1))
  done
}

# A case is a tree of processes (the subshell, then bash, node, the solver), so stop the tree.
_pool_killtree() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null); do _pool_killtree "$c"; done
  kill "$1" 2>/dev/null
}

_pool_abort() {
  local p
  for p in ${_POOL_PIDS:-}; do _pool_killtree "$p"; done
  wait 2>/dev/null
  trap - INT TERM
  rm -rf "${_POOL_TMP:-/nonexistent-pool}"
  exit "${1:-1}"
}
