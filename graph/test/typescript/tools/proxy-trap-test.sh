#!/bin/bash
# =============================================================================
# WHICH FUNCTIONS THE INSTRUMENTER TREATS AS PROXY TRAPS, AND WHICH IT DOES NOT.
#
# A trap is invoked by the engine of the language, on a property access or an `in`
# test, never by a call written at a site. Instrumented with `enter` it consumes the
# marker of whatever site is open at that moment, and since the receiver is typically
# a draft or a wrapper, that is any native operation on one, anywhere. The trap is
# then recorded as the target of a call it has nothing to do with.
#
# The object-literal form was already handled. The form this pins is the handler
# FILLED IN AFTERWARDS, which is how a handler that forwards to another one is
# written and which the literal check cannot see:
#
#     const h: ProxyHandler<S> = {}
#     for (const k in base) h[k] = function () { ... }
#     h.set = function (...) { ... }
#
# THE CONTROLS ARE THE POINT. Two functions here must stay SCOREABLE, and they are
# what keeps the rule from swallowing ordinary code: a non-trap name parked on a
# handler, and a trap NAME on an object that is not a handler at all.
# =============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(cd "$HERE/.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/src" "$W/out" "$W/tables"

fail=0; checks=0
ok()  { checks=$((checks+1)); echo "  ok   $1"; }
bad() { checks=$((checks+1)); fail=$((fail+1)); echo "  FAIL $1"; }

cat > "$W/src/main.ts" <<'EOF'
type S = {v: number}

// the handler is declared empty and filled in afterwards
const handler: ProxyHandler<S> = {}
handler.get = function (t: S, k: string) { return (t as any)[k] }
handler["set"] = function () { return true }
// CONTROL: a trap-shaped object may still hold a helper, and a helper is not a trap
handler.helper = function () { return 1 }

// CONTROL: `get` on something that is not a handler is an ordinary method
const other: Record<string, Function> = {}
other.get = function () { return 2 }

// the literal form, which already worked and must keep working
const inline = new Proxy({v: 1} as S, {has() { return true }, ownKeys() { return [] }})

export {handler, other, inline}
EOF

node "$TS/runtime-oracle/instrument.mjs" --src "$W/src" --out "$W/out" --tables "$W/tables" \
  > "$W/log" 2>&1 || { echo "proxy-trap: instrument.mjs failed"; cat "$W/log"; exit 1; }

# decls.tsv: decl_id file start_line start_col name kind
tag() { awk -F'\t' -v n="$1" 'NR>1 && $5==n {print $6}' "$W/tables/decls.tsv"; }

for n in 'handler.get' 'handler["set"]' 'has' 'ownKeys'; do
  [ "$(tag "$n")" = "proxy_trap" ] \
    && ok "$n is a trap" \
    || bad "$n should be a trap, got '$(tag "$n")'"
done

# The controls. A rule that tags these has stopped being about proxies.
for n in 'handler.helper' 'other.get'; do
  t="$(tag "$n")"
  [ -n "$t" ] && [ "$t" != "proxy_trap" ] \
    && ok "$n stays scoreable ($t)" \
    || bad "$n must not be a trap, got '${t:-nothing}'"
done

if [ "$fail" -ne 0 ]; then
  echo "proxy-trap: FAILED ($checks checks)"
  exit 1
fi
echo "proxy-trap: ok ($checks checks)"
