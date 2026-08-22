#!/usr/bin/env python3.10
"""Ask the emitted CSVs the questions a consumer would ask, and print what they
can and cannot answer. Reads the CSVs only — no parser internals."""
import sys, os, collections

d = sys.argv[1]
T = {}
for fn in os.listdir(d):
    if not fn.endswith(".csv"): continue
    text = open(os.path.join(d, fn), encoding="utf-8").read()
    if not text.strip(): T[fn] = ([], []); continue
    lines = text.rstrip("\n").split("\n")
    h = lines[0].split("\t")
    T[fn] = (h, [dict(zip(h, l.split("\t"))) for l in lines[1:] if len(l.split("\t")) == len(h)])

def rows(f): return T.get(f, ([], []))[1]
def by(f, **kw):
    return [r for r in rows(f) if all(r.get(k) == v for k, v in kw.items())]

scopes = {r["pyScopeUniqueHash"]: r for r in rows("all-python-scopes.csv")}
methods = {r["pyMethodUniqueHash"]: r for r in rows("all-python-methods.csv")}
types = {r["pyTypeUniqueHash"]: r for r in rows("all-python-types.csv")}

print("=" * 78)
print("ENUMS")
print("=" * 78)
for r in rows("all-python-types.csv"):
    if "ENUM" in r.get("typeCategory", ""):
        print(f"  py_type {r['name']:<10} category={r['typeCategory']:<20} bases={r.get('baseCount')}")
enum_types = {r["pyTypeUniqueHash"]: r["name"] for r in rows("all-python-types.csv") if "ENUM" in r.get("typeCategory","")}
print(f"\n  enum MEMBERS (RED/GREEN/BLUE...) as a dedicated relation: NONE — no py_enum_constant exists")
members = []
for r in rows("all-python-bindings.csv"):
    sc = scopes.get(r["pyScopeLinkHash"])
    if sc and sc["scopeKind"] == "CLASS" and sc["name"] in ("Color", "Flags", "Mode"):
        members.append((sc["name"], r["name"], r.get("bindingKind"), r.get("bindingOrigin")))
print(f"  enum members visible as CLASS-scope py_binding rows: {len(members)}")
for m in members[:6]: print(f"     {m[0]}.{m[1]:<8} bindingKind={m[2]:<14} origin={m[3]}")
print("  -> a consumer can find them, but nothing marks them as enum members,")
print("     and the VALUE (1, 2, 'ro') is not on the binding row.")

print()
print("=" * 78)
print("FIELDS")
print("=" * 78)
print(f"  py_field / py_field_write / py_field_position files present: "
      f"{[f for f in T if 'field' in f] or 'NONE'}")
cls_fields = []
for r in rows("all-python-bindings.csv"):
    sc = scopes.get(r["pyScopeLinkHash"])
    if sc and sc["scopeKind"] == "CLASS" and sc["name"] in ("Account", "Service", "Point"):
        cls_fields.append((sc["name"], r["name"], r.get("bindingOrigin"), r.get("isAnnotated")))
print(f"\n  CLASS-level fields as py_binding rows: {len(cls_fields)}")
for f in cls_fields[:8]: print(f"     {f[0]}.{f[1]:<10} origin={f[2]:<20} annotated={f[3]}")
print("\n  INSTANCE fields (self.owner, self.balance, self._audit):")
inst = [r for r in rows("all-python-bindings.csv") if r["name"] in ("owner", "balance", "_audit")]
print(f"     py_binding rows named owner/balance/_audit: {len(inst)}")
for r in inst[:6]:
    sc = scopes.get(r["pyScopeLinkHash"])
    print(f"       {r['name']:<8} in scope {sc['scopeKind']}|{sc['name']}  origin={r.get('bindingOrigin')}")
attr_exprs = [r for r in rows("all-python-expressions.csv")
              if r.get("expressionKind") == "ATTRIBUTE_ACCESS" and r.get("attributeName") in ("owner","balance","_audit")]
print(f"     py_expression ATTRIBUTE_ACCESS rows for those names: {len(attr_exprs)}")
print("  -> instance attributes exist ONLY as expression nodes. No relation says")
print("     'Account has a field balance', so no attribute type is available.")

print()
print("=" * 78)
print("LOCAL VARIABLES")
print("=" * 78)
comp = [m for m in methods.values() if m["name"] == "compute"]
if comp:
    mh = comp[0]["pyMethodUniqueHash"]
    locs = [r for r in rows("all-python-bindings.csv") if r.get("pyMethodLinkHash") == mh]
    print(f"  py_binding rows linked to method `compute` via pyMethodLinkHash: {len(locs)}")
    for r in sorted(locs, key=lambda r: r["name"])[:14]:
        print(f"     {r['name']:<10} kind={r.get('bindingKind'):<14} origin={r.get('bindingOrigin'):<22}"
              f" local={r.get('isLocal')} param={r.get('isParameter')} type='{r.get('declaredTypeName')}'")
print("  -> locals ARE present, with origin distinguishing for/with/except/walrus.")
print("     declaredTypeName is empty on every one, so no local carries a type.")

print()
print("=" * 78)
print("WHAT A CONSUMER CANNOT ANSWER")
print("=" * 78)
qs = [
 ("What type does local `acc` hold?", "py_binding.declaredTypeName is empty; py_type_inference not emitted"),
 ("What fields does class Account declare?", "no py_field relation"),
 ("Where is self.balance written?", "no py_field_write relation"),
 ("What are Color's members and values?", "no enum-constant relation; values absent"),
 ("What does method deposit return?", "py_method.returnTypeName is 100% empty"),
 ("What type is parameter `amount`?", "py_method_parameter.parameterTypeName is 100% empty"),
 ("Which decorators are on a method?", "no py_decorator relation (decoratorCount only)"),
 ("Which block does a statement sit in?", "no py_block relation"),
]
for q, a in qs: print(f"  {q:<44} {a}")
