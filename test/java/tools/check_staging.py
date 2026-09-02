#!/usr/bin/env python3
"""STAGING GUARD — a relation the parser emits must actually reach the solver.

Adding a relation to the IR touches five places, and the two that fail SILENTLY are the
library ones:

  1. decls_base.dl        .decl java_X / .decl lib_X
  2. client-ir.map        java_X -> all-x          (staged for the client)
  3. lib.map              lib_X  -> all-x          (staged for libraries)
  4. staging.conf LIB_SIG the SUFFIX of lib_X, or LIB_BODY the full name
  5. rules that read it

run-souffle.sh scopes lib.map by LIB_SIG: a row whose suffix is in neither LIB_SIG nor
LIB_BODY is skipped with `continue`, so no .facts file is written, no .input line is
emitted, and the relation is EMPTY ON EVERY RUN. Nothing errors. A rule joining against it
derives nothing and Soufflé says nothing — the same failure as a declared-but-underived
relation, one layer down.

This guard turns that into a build failure. It checks:
  A. every lib.map row is actually staged (LIB_SIG suffix, or LIB_BODY full name)
  B. every client-ir.map relation has a lib.map counterpart, unless it is listed below as
     deliberately client-only
  C. every relation named in either map is declared in decls_base.dl

usage: check_staging.py [--lang java]
exit 1 on any violation.
"""
import os, re, sys

LANG = sys.argv[sys.argv.index('--lang') + 1] if '--lang' in sys.argv else 'java'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')
TPL  = os.path.join(ROOT, 'src', LANG, 'templates')
DECL = os.path.join(ROOT, 'src', LANG, 'souffle', 'decls_base.dl')

# Relations that exist for the CLIENT only, each with the reason. A library's copy of one of
# these would be meaningless, so the asymmetry is intended rather than forgotten.
CLIENT_ONLY = {
    # (none yet — add with a reason, never bare)
}

# Declared in lib.map and deliberately NOT staged yet. Each is a real decision that has not
# been made — staging the platform's annotation table is not free, and deleting the row
# removes a capability someone may intend — so the debt is listed rather than silently
# tolerated — see issue #136. Anti-rot, in both directions: an entry missing from lib.map, or one that HAS
# become staged, fails the guard too, so this list cannot drift out of date.
UNSTAGED_PENDING = {
    'lib_annotation', 'lib_annotation_argument', 'lib_comment',
    'lib_property_key', 'lib_property_value_segment',
    'lib_xml_attribute', 'lib_xml_element', 'lib_xml_value_reference',
    'lib_yaml_property', 'lib_yaml_value_segment',
}

def read_map(p):
    out = {}
    for line in open(p):
        line = line.strip()
        if not line or line.startswith('#'): continue
        parts = line.split('\t')
        if len(parts) >= 2: out[parts[0]] = parts[1]
    return out

def staging_conf(p):
    sig, body = set(), set()
    for line in open(p):
        m = re.match(r'\s*LIB_SIG="([^"]*)"', line)
        if m: sig = set(m.group(1).split())
        m = re.match(r'\s*LIB_BODY="([^"]*)"', line)
        if m: body = set(m.group(1).split())
    return sig, body

client = read_map(os.path.join(TPL, 'client-ir.map'))
lib    = read_map(os.path.join(TPL, 'lib.map'))
sig, body = staging_conf(os.path.join(TPL, 'staging.conf'))
declared = set(re.findall(r'^\.decl\s+(\w+)\(', open(DECL).read(), re.M))

fail = []

# A. a lib.map row that is never staged
for rel in sorted(lib):
    suffix = rel[len('lib_'):]
    staged = suffix in sig or rel in body
    if not staged and rel not in UNSTAGED_PENDING:
        fail.append(f"lib.map stages nothing for {rel}: suffix '{suffix}' is not in LIB_SIG "
                    f"and '{rel}' is not in LIB_BODY, so it is EMPTY on every run")
    if staged and rel in UNSTAGED_PENDING:
        fail.append(f"{rel} IS staged now — remove it from UNSTAGED_PENDING so the list "
                    f"stays an accurate record of what is still unstaged")
for rel in sorted(UNSTAGED_PENDING):
    if rel not in lib:
        fail.append(f"{rel} is in UNSTAGED_PENDING but no longer in lib.map — remove it")

# B. a client relation with no library counterpart
for rel in sorted(client):
    suffix = rel.split('_', 1)[1]
    if suffix in CLIENT_ONLY: continue
    if f'lib_{suffix}' not in lib:
        fail.append(f"client-ir.map stages {rel} but lib.map has no lib_{suffix} — a library "
                    f"shipping the same construct contributes nothing. Add it, or list "
                    f"'{suffix}' in CLIENT_ONLY with the reason.")

# C. declared at all
for rel in sorted(set(client) | set(lib)):
    if rel not in declared:
        fail.append(f"{rel} is staged by a .map but has no .decl in decls_base.dl")

print(f"staging guard ({LANG}): client {len(client)} relations, lib {len(lib)}, "
      f"LIB_SIG {len(sig)}, LIB_BODY {len(body)}, "
      f"deliberately unstaged {len(UNSTAGED_PENDING)}")
for f in fail: print(f"  FAIL  {f}")
print(f"  {len(fail)} violation(s)")
sys.exit(1 if fail else 0)
