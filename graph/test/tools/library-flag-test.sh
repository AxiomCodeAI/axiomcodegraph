#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# `--library a --library b` MUST mean the same as `--library a,b`.
#
# It did not. bin/axiomcode assigned rather than appended, so a repeated flag kept
# only the LAST path and every call into the earlier libraries came back unresolved.
# The run exited 0, and the only signal was a count in one line of output that said
# "1 library root(s)" when two were passed. Worse, the totals went UP, because the
# surviving library's own calls resolved, so a reader comparing runs saw an
# improvement and had no reason to look. See #915.
#
# Asserted on the OUTPUT rather than on the argument string, because the argument
# string is what was wrong and a test that reads it would have passed throughout.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
fail=0; bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
command -v node >/dev/null 2>&1 || { echo "library-flag: SKIP (no node)"; exit 0; }
[ -f "${AXIOM_PARSER:-$ROOT/parser/dist/index.js}" ] || { echo "library-flag: SKIP (no parser)"; exit 0; }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# two libraries with no relation to each other, and a client that calls into BOTH,
# so dropping either one is visible as a missing edge rather than as a smaller total.
mkdir -p "$W/libA/alpha" "$W/libB/beta" "$W/app/probe"
cat > "$W/libA/alpha/Alpha.java" <<'EOF'
package alpha;
public class Alpha { public String one() { return "a"; } }
EOF
cat > "$W/libB/beta/Beta.java" <<'EOF'
package beta;
public class Beta { public String two() { return "b"; } }
EOF
cat > "$W/app/probe/Both.java" <<'EOF'
package probe;
import alpha.Alpha;
import beta.Beta;
public class Both {
    String useA(Alpha a) { return a.one(); }
    String useB(Beta b)  { return b.two(); }
    public static void main(String[] x) { new Both().useA(new Alpha()); new Both().useB(new Beta()); }
}
EOF

named(){ # $1 = out dir, $2 = qualified name fragment
  sqlite3 "$1/java/graph.sqlite" \
    "select count(*) from call_edges ce join methods m on m.id=ce.callee_method_id
      where m.qualified_name like '$2%';" 2>/dev/null || echo 0
}

run(){ # $1 = out dir, rest = library args
  local out="$1"; shift
  ( cd "$W" && "$ROOT/bin/axiomcode" "$W/app" "$out" "$@" --language java ) >"$out.log" 2>&1
}

command -v sqlite3 >/dev/null 2>&1 || { echo "library-flag: SKIP (no sqlite3)"; exit 0; }

run "$W/out-comma"    --library "$W/libA,$W/libB"
run "$W/out-repeated" --library "$W/libA" --library "$W/libB"

for form in comma repeated; do
  a=$(named "$W/out-$form" "alpha.Alpha"); b=$(named "$W/out-$form" "beta.Beta")
  [ "$a" -ge 1 ] || bad "$form: no edge to the FIRST library's method (alpha.Alpha.one)"
  [ "$b" -ge 1 ] || bad "$form: no edge to the SECOND library's method (beta.Beta.two)"
done

ca=$(named "$W/out-comma" "alpha.Alpha"); ra=$(named "$W/out-repeated" "alpha.Alpha")
cb=$(named "$W/out-comma" "beta.Beta");   rb=$(named "$W/out-repeated" "beta.Beta")
[ "$ca" = "$ra" ] && [ "$cb" = "$rb" ] \
  || bad "the two spellings disagree: comma gave ($ca,$cb), repeated gave ($ra,$rb)"

# the count in the run output is the only signal a user gets, so hold it to the truth
for form in comma repeated; do
  n="$(grep -o '[0-9]\+ library root(s)' "$W/out-$form.log" | grep -o '^[0-9]\+' | tail -1)"
  [ "${n:-0}" = "2" ] || bad "$form: reported '${n:-no} library root(s)', two were passed"
done

[ "$fail" = 0 ] && echo "library-flag: ok (repeated and comma forms agree, both libraries staged)" \
                || echo "library-flag: $fail failure(s)"
exit $fail
