#!/usr/bin/env python3
"""A CALL THAT MAY FAIL, IN A POSITION WHERE `set -e` ACTS ON IT, MUST DISPOSE OF ITS STATUS.

`add_lib` and `stage_program` return 1 as an ORDINARY outcome — a deprecated
`@types/<pkg>` stub is a package.json and a README with no `.d.ts`, so staging it
yields no modules. Under `set -e` that ended the whole evaluation from one call site
(#234), silently, mid-staging.

── WHY THIS IS NOT A GREP ──────────────────────────────────────────────────
A first attempt was, and it was wrong in BOTH directions, which its own controls
caught:

  * it flagged `stage_program "$sub" "$name$sfx" && extra=$((extra+1))`, where the
    call is the LEFT operand of `&&`. errexit does not act on a non-final operand of
    an AND-list, so that line is safe and "fixing" it would be noise.

  * it PASSED the very line the issue is about:

        d="$(find_in_nm "@types/$pkg" || true)"; [ -n "$d" ] && add_lib "$d" "x"

    because `|| true` occurs on the line — inside an unrelated command substitution.
    Guardedness is a property of what follows THE CALL, not of the line.

So the rule is evaluated positionally: find the call, take the text that follows it
within its own command, and ask whether that disposes of a non-zero status.

Exit 0 when clean; prints one line per offender and exits 1 otherwise.
"""
import re
import sys

# Functions whose non-zero return is a normal outcome rather than a failure.
FALLIBLE = ('add_lib', 'stage_program')

CALL = re.compile(r'(?<![\w.-])(' + '|'.join(FALLIBLE) + r')\s+(?=["\'$\w])')
DEFINITION = re.compile(r'^\s*(' + '|'.join(FALLIBLE) + r')\s*\(\s*\)')


def strip_comment(line):
    """Drop a trailing comment. Crude but sufficient: these are shell command lines,
    and a `#` inside quotes on one of them would be the exception, not the rule."""
    out, quote = [], None
    for ch in line:
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
        elif ch in '"\'':
            quote = ch
            out.append(ch)
        elif ch == '#' and (not out or out[-1].isspace()):
            break
        else:
            out.append(ch)
    return ''.join(out)


def offenders(path):
    out = []
    with open(path, encoding='utf-8') as fh:
        for n, raw in enumerate(fh, 1):
            line = strip_comment(raw.rstrip('\n'))
            if DEFINITION.match(line):
                continue
            for m in CALL.finditer(line):
                rest = line[m.end():]
                # The call's own command ends at the next `;` or at end of line.
                #
                # ONLY `;`. Splitting on `}` as well looked more thorough and was
                # wrong: `${safe}` is a parameter expansion, so
                #
                #     { add_lib "$d/$sub" "${safe}_$sub" || true; }
                #
                # got cut at the brace inside `${safe}` and its `|| true` was never
                # seen — the lint reported two correctly guarded lines as offenders.
                # A closing `}` that really does end a command group is always
                # preceded by a `;`, so `;` alone is both sufficient and safe.
                seg = re.split(r';', rest, 1)[0]
                if re.search(r'\|\|\s*(true|return\b)', seg):
                    continue          # disposed of explicitly
                if re.search(r'^[^|]*&&', seg):
                    continue          # LEFT operand of an AND-list: errexit exempt
                out.append((n, raw.rstrip('\n')))
    return out


def main(argv):
    if len(argv) < 2:
        print('usage: staging_guard_lint.py <shell-file>...', file=sys.stderr)
        return 2
    bad = []
    for p in argv[1:]:
        bad.extend((p, n, t) for n, t in offenders(p))
    for p, n, t in bad:
        print(f'{p}:{n}: unguarded call — a library that declares nothing ends the run\n    {t.strip()}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
