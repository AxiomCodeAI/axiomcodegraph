#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A LIBRARY THAT DECLARES NOTHING MUST NOT END THE EVALUATION.
#
# `add_lib` returns 1 as an ORDINARY OUTCOME: a deprecated `@types/<pkg>` stub is a
# package.json and a README with no `.d.ts` in it, and staging it yields no modules.
# run-evaluation.sh runs under `set -e`, and one call site was
#
#     [ -n "$d" ] && add_lib "$d" "types_$safe"
#
# where `add_lib` is the command after the final `&&`, so its status IS the AND-list's
# and errexit killed the script. Measured on a project built to contain exactly one
# such stub: exit 1 after 7 lines of output, no error line and no score, against exit
# 0 and a full report from the identical project with the stub removed. See #234.
#
# ── WHY A LINT AND NOT JUST A FIX ───────────────────────────────────────────
# Every OTHER add_lib call in the file was already guarded, which is what made this an
# oversight rather than a decision — and an oversight of a kind that is invisible on
# review, because the guarded and unguarded forms differ by four characters and the
# unguarded one is the more natural thing to write. Sweeping the file found a second
# instance nobody had hit yet (the compiler-API root, a bare call). So the rule is
# checked over the tree rather than the two known sites being patched.
#
# The errexit assertions below are not decoration: they prove the property the lint
# exists to enforce, rather than the lint encoding a belief about shell semantics.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EVAL_SH="$HERE/../run-evaluation.sh"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${STAGING_GUARD_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# ── 1-3. the shell semantics this rests on ──────────────────────────────────
# A helper that fails the way add_lib does, probed inside its own `set -e` shell.
probe() { # $1 = script body -> prints CONTINUED or DIED
  if bash -c "set -e; add_lib(){ return 1; }; d=/tmp; e=\"\"; $1; echo REACHED" 2>/dev/null \
     | grep -q REACHED; then echo CONTINUED; else echo DIED; fi
}

if [ "$(probe '[ -n "$d" ] && add_lib "$d" x')" = DIED ]; then
  ok 'unguarded  [ -n ] && add_lib  does end the script (the defect is real)'
else
  bad 'the unguarded form did NOT die — this shell does not have the behaviour the lint guards against'
fi

if [ "$(probe '[ -n "$d" ] && { add_lib "$d" x || true; }')" = CONTINUED ]; then
  ok 'guarded    [ -n ] && { add_lib || true; }  survives a declaring-nothing library'
else
  bad 'the GUARDED form died — the fix does not actually fix it'
fi

# CONTROL: the guard TEST failing is not what kills it, so `|| true` is addressing the
# right thing. If this ever flips, the diagnosis above is wrong.
if [ "$(probe '[ -n "$e" ] && add_lib "$e" x')" = CONTINUED ]; then
  ok 'control: a false [ -n ] guard does not end the script — only add_lib returning 1 does'
else
  bad 'control: a false guard test also ends the script, so the diagnosis is wrong'
fi

# ── 4. THE LINT over the real file ──────────────────────────────────────────
# Every add_lib / stage_program CALL must dispose of a non-zero status: `|| true` for
# "this root is optional", or `|| return N` inside a function that propagates it.
LINT="$HERE/staging_guard_lint.py"
lint_unguarded() { python3 "$LINT" "$1" 2>&1; }

offending="$(lint_unguarded "$EVAL_SH")"
if [ -n "$offending" ]; then
  bad "an add_lib/stage_program call does not dispose of its status, so a library that declares nothing ends the run:"
  printf '%s\n' "$offending" | sed 's/^/          /'
else
  ok 'lint: every add_lib/stage_program call disposes of a non-zero status'
fi

# ── 5-7. the lint must actually DISCRIMINATE ────────────────────────────────
# A lint that says yes to everything pins nothing, and one that says no to correct
# code blocks ordinary work. The first draft of this check did both: it flagged a
# call in the LEFT operand of an `&&` (where errexit does not act) and it PASSED the
# very line this issue is about, because `|| true` appeared elsewhere on it inside an
# unrelated command substitution. Both directions are asserted now.
cat > "$W/planted.sh" <<'PEOF'
set -e
d="$(find_in_nm "@types/$pkg" || true)"; [ -n "$d" ] && add_lib "$d" "types_$safe"
PEOF
if [ -n "$(lint_unguarded "$W/planted.sh")" ]; then
  ok 'control: rejects the unguarded call even though the LINE contains an unrelated || true'
else
  bad 'control: the lint did NOT reject a planted unguarded call — it pins nothing'
fi

cat > "$W/clean.sh" <<'PEOF'
set -e
[ -n "$d" ] && { add_lib "$d" "types_$safe" || true; }
src_duplicates_staged_subdir "$d" || add_lib "$d" "$safe" || true
add_lib "$WORK/tsc-src" "tscompiler" || true
stage_program "$src" "$name" || return 1
stage_program "$sub" "$name$sfx" && extra=$((extra+1))
[ -d "$d/$sub" ] && { add_lib "$d/$sub" "${safe}_$sub" || true; }
# add_lib "$d" "commented" — a mention in prose is not a call
PEOF
if [ -z "$(lint_unguarded "$W/clean.sh")" ]; then
  ok 'control: accepts every correct form, including an && LEFT operand and a comment'
else
  bad "control: the lint rejected a CORRECT form — it would block ordinary work:
$(lint_unguarded "$W/clean.sh" | sed 's/^/          /')"
fi

if [ "$fail" -ne 0 ]; then
  echo "staging-guard: FAILED ($checks checks)"
  exit 1
fi
echo "staging-guard: ok ($checks checks)"
