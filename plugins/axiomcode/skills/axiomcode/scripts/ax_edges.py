#!/usr/bin/env python3
"""One vocabulary for the hops a chain is made of.

A chain is printed as hops, and the graph does not have one kind of hop. Five front ends name the
same relation differently, and each one has tiers the others never emit. Counted over one project
per language, `call_edges` carries 11 distinct tiers and 30 distinct kinds:

    java        known_edge multi_inferred ambiguous_unknown boundary_lib ambiguous_anon
                method new ctor_delegate anon_new ref
    typescript  + ambient_terminal            FUNCTION_CALL METHOD_CALL CONSTRUCTOR_CALL SUPER_CALL OPTIONAL_CALL
    javascript  + callback_registered implicit_constructor dynamic_terminal fan_capped event_dispatch
                + COMPUTED_CALL IIFE_CALL DYNAMIC_IMPORT_CALL DYNAMIC_CODE_CALL TAGGED_TEMPLATE_CALL
                  FUNCTION_CALL_APPLY FUNCTION_CALL_CALL FUNCTION_CALL_BIND
    python      SIMPLE_CALL METHOD_CALL SELF_CALL SUPER_CALL CHAINED_CALL SUBSCRIPT_CALL CONTEXT_MANAGER
                PROPERTY_READ METACLASS_CREATION DYNAMIC_CALL UNKNOWN_CALLEE_CALL DECORATOR_{APPLICATION,ATTRIBUTE,BARE,CALL}
    csharp      known_edge boundary_generated · new property_read property_write

Two rules hold here, and they are the reason this module exists rather than a dict at the top of
each verb:

  1. EVERY TIER IS LISTED. An unlisted tier used to fall to a default rank that sat BELOW `contains`
     — the synthetic containment hop (`defines`), which is not a call at all. On a JavaScript project 8,916 of
     25,048 traversable edges carry such a tier (`callback_registered`, `event_dispatch`), so the
     chain reader preferred a containment hop to a real registered-callback call on a third of the
     graph. An unrecognised tier now ranks LAST, and says so.

  2. A HOP THAT IS NOT A CALL IS NOT COUNTED AS ONE. `defines` says the callee is written inside
     the caller's body; it runs only after the definer did, which is worth traversing, but "A
     reaches B in 11 calls" is false when five of the eleven are containment. `calls_in()` is what
     a hop count is taken from.
"""

# ── how certain a hop is. Lower is more certain; the reader prefers the lowest at every step. ──────
TIER_RANK = {
    'known_edge': 0,            # one declaration, resolved
    'written': 0,               # the call is written there in the source
    'library': 0,               # into a dependency: terminal, nothing is inferred about its body
    'boundary_lib': 0,
    'boundary_generated': 0,
    'implicit_constructor': 0,  # the constructor the language supplies when none is written
    'multi_inferred': 1,        # several declarations fit; each one is a real candidate
    'dispatch': 2,              # a base method to an override that is actually instantiated
    'callback_registered': 3,   # handed over as a value and invoked by whoever holds it
    'event_dispatch': 3,        # emitted here, handled there
    'defines': 4,               # NOT a call: the callee is written inside the caller's body
    'ambient_terminal': 6,      # into the platform or an ambient declaration: terminal
    'dynamic_terminal': 6,      # the callee is computed at run time and cannot be named
    'fan_capped': 7,            # the candidate set was too large to enumerate; this is a sample
    'ambiguous_anon': 8,
    'ambiguous_unknown': 8,
    'by-name': 9,               # not resolved at all: the names simply match
}
UNRANKED = 10                   # an engine tier this table has not been taught — least certain, never silent

TIER_NOTE = {
    'known_edge':           'resolved to one declaration',
    'multi_inferred':       'several declarations fit; each is a real candidate',
    'dispatch':             'a base method to an override the project instantiates',
    'callback_registered':  'handed over as a value and invoked by whoever holds it',
    'event_dispatch':       'emitted here, handled there',
    'defines':              'NOT a call — written inside that body, so it runs only after it',
    'library':              'into a dependency; the chain ends there',
    'boundary_lib':         'into a dependency; the chain ends there',
    'boundary_generated':   'into a generated member of a dependency',
    'implicit_constructor': 'the constructor the language supplies when none is written',
    'ambient_terminal':     'into the platform or an ambient declaration; the chain ends there',
    'dynamic_terminal':     'the callee is computed at run time and cannot be named',
    'fan_capped':           'the candidate set was too large to enumerate — a sample, not the set',
    'written':              'the call is written at that line',
    'by-name':              'unresolved — the names match and nothing more',
}

# ── what the hop IS, in one word that means the same thing in every language ───────────────────────
KIND = {
    # an ordinary invocation
    'method': 'call', 'METHOD_CALL': 'call', 'FUNCTION_CALL': 'call', 'SIMPLE_CALL': 'call',
    'SELF_CALL': 'call', 'CHAINED_CALL': 'call', 'OPTIONAL_CALL': 'call', 'COMPUTED_CALL': 'call',
    'IIFE_CALL': 'call', 'SUBSCRIPT_CALL': 'call', 'UNKNOWN_CALLEE_CALL': 'call',
    'FUNCTION_CALL_APPLY': 'call', 'FUNCTION_CALL_CALL': 'call', 'FUNCTION_CALL_BIND': 'call',
    'TAGGED_TEMPLATE_CALL': 'call',
    # construction
    'new': 'new', 'CONSTRUCTOR_CALL': 'new', 'anon_new': 'new', 'METACLASS_CREATION': 'new',
    # one constructor to another
    'ctor_delegate': 'ctor', 'SUPER_CALL': 'super',
    # the callable is named, not called at that line — it runs when whoever took it runs it
    'ref': 'method-ref',
    # a declaration handed to a decorator, which is what wires most framework handlers up
    'DECORATOR_APPLICATION': 'decorator', 'DECORATOR_ATTRIBUTE': 'decorator',
    'DECORATOR_BARE': 'decorator', 'DECORATOR_CALL': 'decorator',
    # an accessor: written as a field, run as a method
    'property_read': 'property', 'property_write': 'property', 'PROPERTY_READ': 'property',
    # the language runs it at a block boundary
    'CONTEXT_MANAGER': 'with',
    # run-time code loading
    'DYNAMIC_IMPORT_CALL': 'import', 'DYNAMIC_CODE_CALL': 'eval', 'DYNAMIC_CALL': 'dynamic',
}

NOT_A_CALL = {'defines'}           # a containment relation, not control reaching B. The engine's own name
                                   # for it, kept as the wire name: graph_sql.py and the rules both write it.


def rank(tier):
    """how certain, lowest first. An unlisted tier ranks LAST — never above a real call."""
    return TIER_RANK.get(tier, UNRANKED)


def kind_word(k):
    """the engine's kind in one cross-language word; an unknown kind is passed through as written,
    lowercased, so a new front-end kind shows up as itself rather than disappearing."""
    if not k: return ''
    return KIND.get(k) or k.lower().replace('_', '-')


def calls_in(hops):
    """how many of these hops are calls. `hops` is an iterable of tiers."""
    return sum(1 for t in hops if t not in NOT_A_CALL)


def legend(tiers):
    """one line per tier that appears in an answer, in the order the table lists them."""
    seen = [t for t in sorted(set(t for t in tiers if t), key=rank) if t]
    out = []
    for t in seen:
        note = TIER_NOTE.get(t) or ('this tier is not in the frontend\'s table — treated as least certain')
        out.append(f"    [{t}] {note}")
    return out
