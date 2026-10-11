#!/bin/bash
# compile-lock.sh — ONE COMPILE PER ENGINE ID, sourced by run-souffle.sh.
# Concurrent runs that miss the engine cache together (a suite's concurrent cases, several
# agents on one machine) each compiled the same engine: a multi-GB c++ per run, enough of them
# at once to exhaust memory. The first takes the lock (a directory, created atomically) and
# compiles; the others wait, then reuse its binary.
#
# A LOCK IS DEAD WHEN ITS OWNER IS, NOT WHEN IT IS OLD. The owner writes its PID into the lock,
# and a waiter takes the lock over only when that process is gone (killed, out of memory). An
# age limit of 30 min was wrong both ways: a Python compile takes up to 27 min on a loaded
# machine, so a slower one was taken over while it ran and two multi-GB compiles of one engine
# ran at once. A lock with no PID (an older run's, or one caught between its mkdir and its
# write) is still taken over after COMPILE_LOCK_NOPID_MIN minutes (default 30).
#
#   compile_lock_take <lock>    wait until <lock> is ours (prints one line when it has to wait)
#   compile_lock_drop <lock>    release it
compile_lock_take() {
  local lock="$1" owner waited=0
  until mkdir "$lock" 2>/dev/null; do
    owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$owner" ]; then
      # re-read before removing: another waiter may have taken the dead lock over in between
      if ! kill -0 "$owner" 2>/dev/null && [ "$(cat "$lock/pid" 2>/dev/null || true)" = "$owner" ]; then
        echo "▶ the run compiling this engine (pid $owner) is gone; taking its lock over"
        rm -rf "$lock" 2>/dev/null || true; continue
      fi
    elif [ -n "$(find "$lock" -maxdepth 0 -mmin +"${COMPILE_LOCK_NOPID_MIN:-30}" 2>/dev/null)" ]; then
      rm -rf "$lock" 2>/dev/null || true; continue
    fi
    [ "$waited" = 1 ] || echo "▶ another run${owner:+ (pid $owner)} is compiling this engine; waiting for it..."
    waited=1; sleep "${COMPILE_LOCK_POLL:-3}"
  done
  echo "$$" > "$lock/pid"
}
compile_lock_drop() { rm -rf "$1" 2>/dev/null || true; }
