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

THE LIB NAMING CONVENTION IS NOT THE SAME IN EVERY FRONT END, and this tool used to
assume Java's. Java pairs `java_method` with `lib_method` — the language prefix is
dropped. Python pairs `py_method` with `lib_py_method` — it is kept, and
src/python/templates/staging.conf says so in as many words ("THE PREFIX MUST BE py_:
the executor strips only 'lib_'"). With Java's convention hardcoded, `--lang python`
reported 19 counterpart failures that were all the tool's, so the guard had never run
on that front end at all — the exact hole issue #136 records for Java, one language
over. The convention is now INFERRED from the two maps and asserted to be uniform, so
a third front end needs no edit here and a MIXED convention inside one front end fails
loudly instead of being read as a missing relation.

usage: check_staging.py [--lang java|python]
exit 1 on any violation.
"""
import os, re, sys

LANG = sys.argv[sys.argv.index('--lang') + 1] if '--lang' in sys.argv else 'java'
# tools -> test -> <repo>. This file used to live at test/java/tools and was FOUR levels
# up; it is shared now, so it is three. Getting it wrong makes every path miss and the
# guard pass vacuously, which is the one failure mode a guard must not have.
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
TPL  = os.path.join(ROOT, 'src', LANG, 'templates')
DECL = os.path.join(ROOT, 'src', LANG, 'souffle', 'decls_base.dl')

# Relations that exist for the CLIENT only, each with the reason. A library's copy of one of
# these would be meaningless, so the asymmetry is intended rather than forgotten.
CLIENT_ONLY = {
    # #136 decided these are client-only rather than staged-but-empty. A dependency's OWN
    # properties/YAML/XML is not part of the client's configuration: the client's files are what
    # wire its beans, and the one library-side config that does matter — META-INF/services — is
    # carried by service_descriptor / service_provider, which ARE staged. Neither Python nor
    # TypeScript stages config on the library side either, so the asymmetry is the convention
    # rather than an oversight here.
    #
    # Each was previously declared in lib.map and staged by nothing, so its lib_ projection derived
    # zero rows on every run with no error — the failure mode this guard exists to catch.
    'comment':                'a library\'s comments are not part of the client\'s configuration',
    'property_key':           'a dependency\'s own .properties do not configure the client',
    'property_value_segment': 'segment of property_key, same reason',
    'xml_attribute':          'a dependency\'s own XML does not configure the client',
    'xml_element':            'a dependency\'s own XML does not configure the client',
    'xml_value_reference':    'reference inside xml_element, same reason',
    'yaml_property':          'a dependency\'s own YAML does not configure the client',
    'yaml_value_segment':     'segment of yaml_property, same reason',
}

# Declared in lib.map and deliberately NOT staged. Anti-rot in both directions: an entry missing
# from lib.map, or one that HAS become staged, fails the guard too, so this list cannot drift out
# of date.
#
# Java's set is EMPTY as of #136, which decided all ten of its entries rather than carrying them.
# lib_annotation and lib_annotation_argument are now staged — measured at +11.4 MB on a ~410 MB
# platform library with no steady-state solve cost and byte-identical output, and both Python and
# TypeScript already stage their decorator counterparts, so Java was the outlier. The eight config
# relations were deleted from lib.map instead: nothing read them, neither of the other languages
# stages config on the library side, and META-INF/services — the one library-side config that does
# matter — is covered by service_descriptor / service_provider, which are staged.
#
# An empty set is a claim, not an absence: it says no such decision is pending for this language.
UNSTAGED_PENDING_BY_LANG = {
    'java': set(),
    # Python stages every signature relation it declares and puts the five body relations
    # in LIB_BODY, so there is no debt to record. An entry appearing here later is a
    # decision someone took; an empty set is the claim that no such decision is pending.
    'python': set(),
}
UNSTAGED_PENDING = UNSTAGED_PENDING_BY_LANG.get(LANG, set())

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

# B. a client relation with no library counterpart.
#
# The pairing rule is INFERRED rather than assumed. Every lib.map key starts with `lib_`;
# strip that and each remainder either IS a client relation name (python: py_method /
# lib_py_method) or is one with its language prefix dropped (java: java_method /
# lib_method). Whichever convention accounts for the library rows is the one this front
# end uses; a front end where neither accounts for them, or where both do partially, is
# itself the bug and is reported as such rather than as 19 missing relations.
def _keep(rel): return f'lib_{rel}'
def _drop(rel): return 'lib_' + rel.split('_', 1)[1]

kept = sum(1 for r in client if _keep(r) in lib)
dropped = sum(1 for r in client if _drop(r) in lib)
if kept and dropped and kept != len(client) and dropped != len(client):
    fail.append(f"lib.map mixes two naming conventions: {kept} of {len(client)} client "
                f"relations pair as lib_<rel> and {dropped} as lib_<rel-without-prefix>. "
                f"One front end must pick one, or every consumer has to guess.")
counterpart = _keep if kept >= dropped else _drop
for rel in sorted(client):
    suffix = rel.split('_', 1)[1]
    if suffix in CLIENT_ONLY: continue
    want = counterpart(rel)
    if want not in lib:
        fail.append(f"client-ir.map stages {rel} but lib.map has no {want} — a library "
                    f"shipping the same construct contributes nothing. Add it, or list "
                    f"'{suffix}' in CLIENT_ONLY with the reason.")

# C. declared at all
for rel in sorted(set(client) | set(lib)):
    if rel not in declared:
        fail.append(f"{rel} is staged by a .map but has no .decl in decls_base.dl")

if not client or not lib:
    print(f"staging guard ({LANG}): no maps found under {TPL} — refusing to pass vacuously")
    sys.exit(1)
print(f"staging guard ({LANG}): client {len(client)} relations, lib {len(lib)}, "
      f"LIB_SIG {len(sig)}, LIB_BODY {len(body)}, "
      f"deliberately unstaged {len(UNSTAGED_PENDING)}")
for f in fail: print(f"  FAIL  {f}")
print(f"  {len(fail)} violation(s)")
sys.exit(1 if fail else 0)
