# shellcheck shell=bash
# Sourced, not run: sets SANDBOX_PATH, a PATH on which `souffle` cannot be found and every
# other tool still can. Sets SHADOW to a directory the caller removes (it may be empty).
#
# SOUFFLE IS HIDDEN BY REMOVING ITS DIRECTORY, not by rebuilding a minimal PATH from a
# whitelist of symlinks. The whitelist cannot work on macOS: /usr/bin/shasum is a perl
# script and the system perl dispatches on the script's CANONICAL path, so a symlink to
# it, or even a copy of it, is refused with "perl version 5.30.3 can't run <path>".
# The sandbox was then left with no digest tool at all, so every check failed for a
# reason that had nothing to do with what it tested.
#
# Directories are compared PHYSICALLY (pwd -P): on a merged-/usr Linux /bin is a symlink
# to /usr/bin, so a logical compare keeps /bin and souffle stays reachable through it.
# And where souffle shares its directory with the system tools (/usr/bin on Ubuntu),
# dropping that directory would take bash and sed with it, so it is REPLACED by a shadow
# holding every entry except souffle's own. On macOS souffle sits in Homebrew's bin, so
# the shadow never stands in for /usr/bin and shasum is never symlinked.
SHADOW=""
SOUFFLE_BIN="$(command -v souffle 2>/dev/null || true)"
if [ -n "$SOUFFLE_BIN" ]; then
  SOUFFLE_DIR="$(cd "$(dirname "$SOUFFLE_BIN")" && pwd -P)"
  SHADOW="$(mktemp -d)"
  for e in "$SOUFFLE_DIR"/*; do
    case "$(basename "$e")" in souffle*) continue;; esac
    ln -s "$e" "$SHADOW/$(basename "$e")" 2>/dev/null || true
  done
  SANDBOX_PATH="$(printf '%s' "$PATH" | tr ':' '\n' | while IFS= read -r d; do
    [ -n "$d" ] || continue
    rd="$(cd "$d" 2>/dev/null && pwd -P)" || continue
    if [ "$rd" = "$SOUFFLE_DIR" ]; then printf '%s:' "$SHADOW"; else printf '%s:' "$d"; fi
  done)"
  SANDBOX_PATH="${SANDBOX_PATH%:}"
else
  SANDBOX_PATH="$PATH"
fi
