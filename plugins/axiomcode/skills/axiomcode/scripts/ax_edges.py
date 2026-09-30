#!/usr/bin/env python3
"""One vocabulary for the hops a chain is made of.

A chain is printed as hops, and the graph does not have one kind of hop. Five front ends name the
same relation differently, and each one has tiers the others never emit. Counted over one project
per language, `call_edges` carries 11 distinct tiers and 30 distinct kinds:

    java        known_edge multi_inferred ambiguous_unknown boundary_lib ambiguous_anon
                method new ctor_delegate anon_new ref
    typescript  + ambient_terminal intrinsic_terminal FUNCTION_CALL METHOD_CALL CONSTRUCTOR_CALL SUPER_CALL OPTIONAL_CALL
    javascript  + callback_registered implicit_constructor dynamic_terminal fan_capped event_dispatch
                + COMPUTED_CALL IIFE_CALL DYNAMIC_IMPORT_CALL DYNAMIC_CODE_CALL TAGGED_TEMPLATE_CALL
                  FUNCTION_CALL_APPLY FUNCTION_CALL_CALL FUNCTION_CALL_BIND
    python      SIMPLE_CALL METHOD_CALL SELF_CALL SUPER_CALL CHAINED_CALL SUBSCRIPT_CALL CONTEXT_MANAGER
                PROPERTY_READ METACLASS_CREATION DYNAMIC_CALL UNKNOWN_CALLEE_CALL DECORATOR_{APPLICATION,ATTRIBUTE,BARE,CALL}
    csharp      + boundary_generated known_implicit_ctor known_builtin_operator ambiguous_dynamic fan_capped event_dispatch
                  runtime_observed (only with a runtime trace) · new property_read property_write

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
import collections, re

# ── how certain a hop is. Lower is more certain; the reader prefers the lowest at every step. ──────
TIER_RANK = {
    'known_edge': 0,            # one declaration, resolved
    'written': 0,               # the call is written there in the source
    'library': 0,               # into a dependency: terminal, nothing is inferred about its body
    'boundary_lib': 0,
    'boundary_generated': 0,
    'implicit_constructor': 0,  # the constructor the language supplies when none is written
    'known_implicit_ctor': 0,   # the same, in C#: the compiler supplies it, no user code runs
    'known_builtin_operator': 0,  # a built-in operator or conversion: no user code runs
    'runtime_observed': 1,      # seen in a runtime trace; real, but no call site stands behind it
    'multi_inferred': 1,        # several declarations fit; each one is a real candidate
    'dispatch': 2,              # a base method to an override that is actually instantiated
    'decorated_call': 0,        # a call written with a decorated name: it runs the wrapper, which calls the decorated def
    'callback_registered': 3,   # handed over as a value and invoked by whoever holds it
    'event_dispatch': 3,        # emitted here, handled there
    'remote': 5,                # a request crosses a process to its handler (remote_edge): no call site names it.
    'framework': 5,             # a framework runs the other end for this one (framework_edge). Both 5, the default
                                # impact's route reader already gave them (P.TIER_RANK.get(t, 5)), so its routes do not move
    'defines': 4,               # NOT a call: the callee is written inside the caller's body
    'ambient_terminal': 6,      # into the platform or an ambient declaration: terminal
    'intrinsic_terminal': 6,    # a JSX intrinsic element or a dynamic import(): nothing the graph can name
    'dynamic_terminal': 6,      # the callee is computed at run time and cannot be named
    'fan_capped': 7,            # the candidate set was too large to enumerate; this is a sample
    'ambiguous_anon': 8,
    'ambiguous_dynamic': 8,     # a call through C# `dynamic`: undecidable from source by design
    'ambiguous_unknown': 8,
    'by-name': 9,               # not resolved at all: the names simply match
    'stub': 9,                  # written inside a mock's stub or verification: named, never run (stub_sites)
}
UNRANKED = 10                   # an engine tier this table has not been taught — least certain, never silent

TIER_NOTE = {
    'known_edge':           'resolved to one declaration',
    'multi_inferred':       'several declarations fit; each is a real candidate',
    'dispatch':             'a base method to an override the project instantiates or loads by its dotted name',
    'decorated_call':       'a call written with a decorated name: it runs the decorator\'s wrapper, and the wrapper calls this',
    'callback_registered':  'handed over as a value and invoked by whoever holds it',
    'event_dispatch':       'emitted here, handled there',
    'remote':               'NOT a call site: a request crosses a process to the handler that serves it (transport and destination on the hop)',
    'framework':            'NOT a call site: a framework runs the other end for this one (mechanism and registration on the hop)',
    'defines':              'NOT a call — written inside that body, so it runs only after it',
    'library':              'into a dependency; the chain ends there',
    'boundary_lib':         'into a dependency; the chain ends there',
    'boundary_generated':   'into a generated member of a dependency',
    'implicit_constructor': 'the constructor the language supplies when none is written',
    'known_implicit_ctor':  'the constructor the compiler supplies when none is written; no user code runs',
    'known_builtin_operator': 'a built-in operator or conversion; no user code runs',
    'runtime_observed':     'seen in a runtime trace; no call site in the source stands behind it',
    'intrinsic_terminal':   'a JSX intrinsic element or a dynamic import(); the chain ends there',
    'ambiguous_dynamic':    'a call through `dynamic`, undecidable from the source',
    'ambiguous_anon':       'an anonymous-class creation the engine has no rule for yet',
    'ambiguous_unknown':    'the engine could not resolve this site',
    'ambient_terminal':     'into the platform or an ambient declaration; the chain ends there',
    'dynamic_terminal':     'the callee is computed at run time and cannot be named',
    'fan_capped':           'the candidate set was too large to enumerate — a sample, not the set',
    'written':              'the call is written at that line',
    'by-name':              'unresolved — the names match and nothing more',
    'stub':                 'written inside a mock\'s stub or verification; the real method does not run there',
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

# A HOP NO CALL SITE EXPRESSES, read from the engine's own relations rather than call_edges: a request to the handler that
# serves it (ext_remote_edge) and a hand-over a framework makes (ext_framework_edge: a fixture a test names, a signal and
# its receiver, a filter wrapping an endpoint). `impact` lists the far end as a [remote] / [framework] dependent; `path`
# walks them as hops (#1469) and says on each one what it is. Only the path finder adds them: impact's closure keeps
# them as direct rows, the contract #1509 set, so they are not written to edge.facts.
OUTSIDE_CALL = ('remote', 'framework')

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


# ── the direct-dependents layer: tier → how sure, and what to call it ─────────────────────────────
# The layer a reader sees FIRST used to decide this with one expression, in three places:
#
#     'one of a set' if tier == 'multi_inferred' else 'resolved'
#
# — a binary test standing in for an eleven-value vocabulary, so every other tier became `resolved`,
# the strongest claim this tool makes, printed as "[resolved] … — calls it". Surveyed over 226
# graphs: 13,189 javascript `callback_registered`, 696 javascript `event_dispatch`, 953 typescript
# `ambient_terminal` and 116 java `fan_capped` edges were labelled that way. None of them is a
# resolved call to the declaration: a hand-off is the engine recording that the callable was passed
# as a value, and a capped fan-out exists precisely BECAUSE the candidate set was too large to
# enumerate, so what is in the graph is a sample of it.
DIRECT_CERT = {
    'known_edge': 'resolved', 'decorated_call': 'resolved', 'boundary_lib': 'resolved', 'boundary_generated': 'resolved',
    'implicit_constructor': 'resolved', 'written': 'resolved',
    'known_implicit_ctor': 'resolved', 'known_builtin_operator': 'resolved', 'runtime_observed': 'resolved',
    'multi_inferred': 'one of a set',
    'callback_registered': 'registered', 'event_dispatch': 'registered',
    'ambient_terminal': 'registered', 'dynamic_terminal': 'registered', 'intrinsic_terminal': 'registered',
    'fan_capped': 'capped set',
    'stub': 'stubs it',             # a call inside a mock's stub or verification (stub_sites below): named, never run
    'remote': 'remote', 'framework': 'framework',   # impact's own rung names for the same two hops (#1469)
}
DIRECT_CERT_DEFAULT = 'registered'   # unlisted: an edge the engine asserted and this table cannot name — never `resolved`

# what the row SAYS, where "calls it" would be false or misleading
DIRECT_WHY = {
    'registered': 'handed over as a value — the engine recorded the hand-off, not a call site',
    'capped set': 'calls it, as one of a candidate set too large to enumerate — this is a sample of that set',
    'stubs it': 'stubs it on a mock: the real method does not run there, and the test breaks only if the name or parameters change',
}
# …and where the TIER says something more specific than its certainty. A request or event is not handed over as a
# value (a JavaScript callback's wording): the dependent sends it, and a framework runs the handler for what is sent.
TIER_WHY = {
    'decorated_call': 'calls it through its decorator: the name it writes is rebound to the decorator\'s wrapper, which calls this',
    'event_dispatch': 'sends the request or event this handles, or builds the class mock whose proxy runs this constructor — a framework runs it for what is sent here, no call site names it',
}


def direct_why(tier):
    """what a DIRECT dependent row says for an edge of this tier."""
    return TIER_WHY.get(tier) or DIRECT_WHY.get(direct_cert(tier), 'calls it')


# …and a call written against a declaration this one is override-equivalent to (#1542): the caller names the interface
# or base method, and the declaration asked about is what runs there. Worded by the kind of type declaring the base.
# The service-layer shape (a controller holding an interface-typed field, the implementation behind it) is the common
# one; before this row its callers showed only under "reaches those", and an agent read that as "few callers".
VIA_BASE_WHY = {
    'interface': 'calls it (via the interface)',
    'class': 'calls it (via the base class)',
}
BODILESS_BASE = {'interface', 'protocol', 'trait'}   # a base of this kind cannot itself be what runs at the call


def via_base_why(base_kind):
    """what a direct row says for a caller that reaches this declaration through a base declaration of this kind"""
    return VIA_BASE_WHY['interface' if (base_kind or '').lower() in BODILESS_BASE else 'class']


# ── entry points: what the reason token means, said in words ───────────────────────────────────────────────
# `entry_points.reason` is an engine token (`orm_hook`, `bean_ctor`, `framework_hook`). Printed raw inside a fixed
# sentence it read "is a orm_hook entry point … Changing it changes what the outside world can call" for a model
# configuration callback the ORM runs at startup, which no outside caller ever reaches. Two kinds, one table:
#   OUTSIDE  a request, a process start, a remote client, a command line or a message reaches it: changing it
#            changes what the outside world can call, and the sentence says so (unchanged).
#   CALLBACK the framework calls it back (a hook, a lifecycle method, a constructor it runs, a factory, a fixture, a
#            provider): a change breaks that framework contract, not an outside caller.
# Every surface that words an entry point (impact's entry line and `next:`, path) reads this table. A token it has not
# seen is worded "framework-called (<token>)", never printed bare, and is a callback: the weaker claim.
ENTRY = {
    'http': ('an HTTP route handler', 'outside'), 'url': ('a URL route handler', 'outside'),
    'main': ('a program entry point', 'outside'), 'grpc_service': ('a gRPC service method', 'outside'),
    'hub': ('a real-time hub method', 'outside'), 'cli': ('a command-line command', 'outside'),
    'queue': ('a message consumer', 'outside'), 'task': ('a background task a queue runs', 'outside'),
    'web_filter': ('a web request filter', 'outside'),
    'web_servlet': ('a servlet the web container dispatches requests to', 'outside'),
    'package_export': ('an export of the package', 'outside'),
    'exported_from_entry_module': ('an export of the entry module', 'outside'),
    'unimported_module': ('a module run directly, which nothing imports', 'outside'),
    'framework_hook': ('a framework hook', 'callback'), 'orm_hook': ('a model hook the ORM or validation library runs', 'callback'),
    'lifecycle': ('a lifecycle callback', 'callback'), 'bean_ctor': ('a constructor the container runs to build a bean', 'callback'),
    'factory': ('a factory method the container calls', 'callback'), 'fixture': ('a test fixture', 'callback'),
    'lifecycle_init': ('an init method the container calls on the bean it built', 'callback'),
    'lifecycle_destroy': ('a destroy method the container calls on the bean it built', 'callback'),
    'service_loader': ('a provider a service loader instantiates', 'callback'),
    'spring_factories': ('an auto-configuration class the container loads', 'callback'),
    'di_provider': ('a dependency-injection provider', 'callback'), 'signal_receiver': ('a signal receiver', 'callback'),
    'web_listener': ('a web container listener', 'callback'), 'scheduled': ('a scheduled job', 'callback'),
    'event_listener': ('an event listener', 'callback'),
    'test': ('a test', 'test'),
}


def entry_phrase(reason):
    """'an ORM model hook' for `orm_hook`; an unknown token is 'a framework-called (<token>) method'"""
    return ENTRY[reason][0] if reason in ENTRY else f"a framework-called ({reason}) method"


def entry_outside(reason):
    """does the outside world (a request, a process start, a client, a message) call an entry point of this reason?"""
    return ENTRY.get(reason, ('', 'callback'))[1] == 'outside'

# certainties that are backed by an edge the ENGINE asserted, as opposed to a name or a text match.
# Consumers that used to test `cert == 'resolved'` to mean "this row claims an edge" test this
# instead: the membership is exactly what it was before this table existed, so no row leaves any
# set — only the label it is printed under changes. It matters most for the --delete verdict, where
# dropping a hand-off would turn "something still holds this" into "safe to delete".
EDGE_BACKED = frozenset({'resolved', 'one of a set', 'registered', 'capped set', 'stubs it'})

# most certain first. A caller with several call sites to the same callee can hold sites of different
# tiers; a summary that names the caller once takes the best of them, which is the honest reading of
# "at least one resolved call exists here".
DIRECT_ORDER = ('resolved', 'one of a set', 'registered', 'capped set', 'stubs it')


# ── `defines`: a callable written inside another one's body ────────────────────────────────────────────────
# Nobody calls a lambda or an anonymous class's method by name, but it runs only after its definer did, so the walk
# takes the hop. A declaration carries no columns, only a line span, and a span is evidence of containment only when it was
# WRITTEN and is STRICTLY wider. Two spans that were not:
#   · a member the engine synthesises (a Lombok accessor or constructor; id `generated:…`) is given its
#     type's span, so it "contained" every method of the type and each generated
#     accessor defined every other (#1402). No line declares it, so it defines nothing and nothing defines it.
#   · two callables on one line have the same span, and the stack used to push the second as the first's child,
#     in whichever direction their ids sorted (#1399): `modeA() { } modeB() { }`, a one-line record's accessors,
#     a C# `{ get; set; }` pair. On an equal span the only containment the name can vouch for is an anonymous
#     callable inside a named one (`Runnable r() { return new Runnable() { public void run() {…} }; }`,
#     `int f() => xs.Sum(x => x.n);`): it nests under the callable with fewer anonymous scopes in its display.
#     Two at the same depth are siblings.
#   · when a line holds more than one candidate definer (`Runnable a() { return new Runnable() {…}; } Runnable b() {…}`,
#     or an anonymous class inside another's method), the display cannot say which one it sits in: the anon's display
#     names its type, not its method. The call sites can: they carry columns, and the definer is the callable one of
#     whose sites (the `new Runnable() {…}` itself, or the call a lambda is passed to) spans a site of the anon's own.
#     The narrowest such site wins, so an anon inside an anon nests under the inner method, not the outer one. An anon
#     that makes no call has no site to place it by and keeps the stack's answer.
#   · a front end whose qualified names follow the source's own nesting (JavaScript: `keys.outer.<function-expression>`
#     is written inside `keys.outer`, `keys.<arrow>` beside it) says outright which callable on a line holds an
#     anonymous one, with or without a call site: on an equal span it nests only under a callable whose qualified name
#     its own extends. `function first() {…} const xs = [1].map(function (v) {…});` are siblings (#1598). Java, C# and
#     TypeScript name a lambda or an anonymous class after its type, not its method, so there the name says nothing.
# Only these scopes are anonymous. A named constructor or initializer (`<constructor>`, `<primary-constructor>`,
# `<static-init>`, `<clinit>`, `<classbody>`, `<module>`) is a sibling of the methods written beside it.
_ANON_SCOPE = re.compile(r'(?:^|\.)<(?:anon[ >]|lambda>|arrow>|function-expression>|locals>)')


def anon_depth(display):
    """how many anonymous scopes (`<anon X>`, `<lambda>`, `<arrow>`, `<function-expression>`, `<locals>`) a callable's
    display passes through"""
    return len(_ANON_SCOPE.findall(display or ''))


# A class's synthesized initializer spans the fields it runs, and a method written between two of them lies inside
# that span without being written inside any initializer (#1663): it is the initializer's sibling, and its display
# says so, the same owner and no scope of the initializer's in between. What an initializer does define (an arrow or
# a function expression handed to a call in it) has a display that is not the initializer's sibling.
_NAMED_INIT = re.compile(r'(?:^|\.)<(?:static-init|instance-init|clinit|classbody)>$')


def _sibling_of_init(display, init_display):
    """`Type.m` beside `Type.<static-init>`: a member of the initializer's owner, not a callable written inside it"""
    if not init_display or not _NAMED_INIT.search(init_display) or not display or anon_depth(display): return False
    owner = init_display.rsplit('.', 1)[0] if '.' in init_display else ''
    return bool(owner) and display.rsplit('.', 1)[0] == owner and '.' in display


def init_holds(init_display, init_qname, display, qname):
    """a named initializer holds a callable on its own line span: `static cfg = make({ run() {…} });` gives the
    initializer and `run` the same one line, and line spans alone call them siblings. The qualified name says `run`
    is written under the initializer's owner (`src/a.ObjLit.run`), and the display that it is not a member of it
    (`run`, `ObjLit.<anonymous-class>.m`), so the initializer defines it. A function written after a one-line class
    has no such qualified name, and a method of the class is the initializer's sibling."""
    if not (init_display and _NAMED_INIT.search(init_display) and init_qname and qname and display): return False
    if '.' not in init_qname or _sibling_of_init(display, init_display): return False
    return qname.startswith(init_qname.rsplit('.', 1)[0] + '.') and qname != init_qname


def _within(inner, outer):
    """a call site's (line, col, end_line, end_col) lies inside another's and is not the same one"""
    return inner != outer and outer[:2] <= inner[:2] and inner[2:] <= outer[2:]


def sites_of(q):
    """the `sites` argument of defines_edges over a graph: q(sql, params) -> rows"""
    def sites(ids):
        for k in range(0, len(ids), 500):
            part = ids[k:k + 500]
            yield from q(f"""SELECT caller_id, start_line, start_column, end_line, end_column FROM call_sites
                             WHERE caller_id IN ({','.join('?' * len(part))})""", tuple(part))
    return sites


_LEXICAL_IDS = ('JS_METHOD_',)     # front ends whose qualified name of a callable extends the one it is written in


def defines_edges(callables, sites=None):
    """(definer, defined, 'defines') for callables given as (file, line, end_line, id, display, method_id[, qualified_name]).
    `sites(method_ids)` returns (caller_id, line, col, end_line, end_col) for the call sites of those callables; it is
    asked only about lines where more than one callable could have defined an anonymous one."""
    byfile = {}; mid_of = {}; lex = {}; disp_of = {}; qn_of = {}
    for f, ln, en, i, disp, mid, *qn in callables:
        if not (ln and en) or str(mid or i).startswith('generated:'): continue
        byfile.setdefault(f, []).append((ln, -en, anon_depth(disp), i)); mid_of[i] = mid or i; disp_of[i] = disp
        qn_of[i] = qn[0] if qn else None
        if qn and qn[0] and str(mid or i).startswith(_LEXICAL_IDS): lex[i] = qn[0]
    holds = lambda c, x: init_holds(disp_of[c], qn_of[c], disp_of[x], qn_of[x])
    def may_hold(c, x):
        """on an equal span: c may be x's definer unless both names follow the nesting and x's does not extend c's, or
        c is a class's initializer holding x (a member of an object or class written in it: `src/a.C.run`)"""
        return c not in lex or x not in lex or lex[x].startswith(lex[c] + '.') or holds(c, x)
    parent = {}; groups = []
    for f, rows in byfile.items():
        # at an equal span a named initializer comes first, so what it holds on its line finds it on the stack
        rows.sort(key=lambda r: (r[0], r[1], r[2], not _NAMED_INIT.search(disp_of[r[3]] or ''), r[3])); st = []
        for ln, neg, d, i in rows:
            # pop what ends before this one ends (END against END, not against this one's start: the two agree on nested
            # spans and not on overlapping ones), and a sibling: the same span at the same depth, unless it is an
            # initializer holding this one on its line (init_holds)
            while st and (st[-1][1] < -neg or (st[-1][0] == ln and st[-1][1] == -neg and st[-1][2] >= d
                                               and not holds(st[-1][3], i))): st.pop()
            # past an equal span the name says it is not written in (kept on the stack: a later one may be), and past a
            # class's initializer when this is a member of that class beside it (#1663)
            j = len(st) - 1
            while j >= 0 and (_sibling_of_init(disp_of[i], disp_of[st[j][3]])
                              or (st[j][0] == ln and st[j][1] == -neg and not may_hold(st[j][3], i))): j -= 1
            if j >= 0 and st[j][3] != i: parent[f, i] = st[j][3]
            st.append((ln, -neg, d, i))
        # equal spans holding an anonymous callable and more than one other candidate to have written it
        span = {}
        for ln, neg, d, i in rows: span.setdefault((ln, neg), []).append((d, i))
        for g in span.values():
            if any(d for d, _ in g) and (len(g) > 2 or all(d for d, _ in g)): groups.append((f, g))
    if groups and sites:
        want = {mid_of[i] for _, g in groups for _, i in g}
        at = {}
        for c, ln, col, en, ecol in sites(sorted(want)):
            if None not in (ln, col, en, ecol): at.setdefault(c, []).append((ln, col, en, ecol))
        for f, g in groups:
            for d, x in g:
                if not d: continue
                best = None                     # the innermost containing site: latest start, then earliest end
                for _, c in g:
                    if c == x: continue
                    for o in at.get(mid_of[c], ()):
                        if any(_within(s, o) for s in at.get(mid_of[x], ())):
                            k = (-o[0], -o[1], o[2], o[3])
                            if best is None or k < best[0]: best = (k, c)
                if best: parent[f, x] = best[1]
    return [(p, i, 'defines') for (_, i), p in parent.items()]


# ── a STUB SITE: a call written inside a mocking library's stub or verification ─────────────────────────────
# `when(repo.find(id)).thenReturn(x)`, `verify(repo).save(x)`, `mock.Setup(r => r.Find(id))`,
# `sub.Received().Save(x)`, `sub.Find(id).Returns(x)`. The engine resolves `repo.find` to the declared method, which
# is right about the NAME (a rename or a new parameter breaks the test) and wrong about EXECUTION: the receiver is a
# mock, so the real body never runs there. Walked as a call, every stub was a `[sound]` route from the test to the
# real method, and "which tests run this body" was answered with the tests that replace it. Measured on a Spring REST
# project: all 8 tests named for a service method stubbed it on a @MockBean, and none of them ran it.
#
# A site is a stub site by its POSITION against the wrapper's own call site (the parser records both spans), never by
# its own name, and only when the wrapper did NOT resolve to a client declaration: a project method called `when` or
# `Setup` is not the library's. Three shapes, one knob table per language:
#   arg     the stubbed call is the wrapper's ARGUMENT, the outermost call in it: `when(x.m(a()))` marks m and not a(),
#           which runs for real to build the stub's argument; `mock.Setup(x => x.M())` marks M
#   prefix  the wrapper's RESULT is the stubbed call's receiver: `verify(x).m()`, `sub.Received(1).M()`. Mockito's
#           `doReturn(v).when(x).m()` is this shape too, and `when` counts here only behind a do* call, because an HTTP
#           test DSL writes a request as `given().when().get("/orders")` and that `get` is the request, not a stub
#   recv    the stubbed call is the wrapper's RECEIVER: NSubstitute's `sub.M(a).Returns(v)`
# Python has no row on purpose: unittest.mock replaces an attribute by STRING (`patch("pkg.mod.f")`,
# `patch.object(C, "m")`) and a MagicMock receiver is untyped, so no call on a mock resolves to a client method.
STUB_WRAPPERS = {
    'java': {
        'arg': {'when', 'given'},                                          # Mockito.when, BDDMockito.given
        'prefix': {'verify', 'should'},                                    # verify(x).m(), then(x).should().m()
        'prefix_after_do': {'when'},                                       # doReturn(v).when(x).m()
        'recv': set(),
        'lambda_arg': False,
    },
    'csharp': {
        # Moq's mock.Setup(x => x.M()), FakeItEasy's A.CallTo(() => f.M()). The stubbed call is written in a LAMBDA
        # (lambda_arg below): a snapshot library's `Verify(await svc.Get())` runs Get for real, and a BDD runner's
        # `.When(x => GetOrders())` runs its lambda, so `When` is not in the table at all
        'arg': {'Setup', 'SetupGet', 'SetupSet', 'SetupSequence', 'SetupProperty', 'Verify', 'VerifyGet', 'VerifySet',
                'CallTo', 'CallToSet'},
        'lambda_arg': True,
        'prefix': {'Received', 'DidNotReceive', 'ReceivedWithAnyArgs', 'DidNotReceiveWithAnyArgs'},   # NSubstitute
        'prefix_after_do': set(),
        'recv': {'Returns', 'ReturnsForAnyArgs', 'ReturnsNull', 'ReturnsNullForAnyArgs', 'Throws', 'ThrowsAsync',
                 'ThrowsForAnyArgs', 'ThrowsAsyncForAnyArgs'},                                        # NSubstitute
    },
}
STUB_DO = {'doReturn', 'doThrow', 'doNothing', 'doAnswer', 'doCallRealMethod'}
STUB_LANG = {'java': 'java', 'kt': 'java', 'groovy': 'java', 'cs': 'csharp'}
STUB_TIER = 'stub'


def _short(name):
    """a call site's callee as written, reduced to its simple name: `Mockito.when` -> when, `Substitute.For<T>` -> For"""
    n = re.sub(r'<.*$', '', (name or '').replace('()', '')).strip()
    return n.rsplit('.', 1)[-1]


def _stub_lang(f):
    return STUB_LANG.get((f or '').rsplit('.', 1)[-1]) if '.' in (f or '') else None


def stub_sites(q):
    """the ids of the call sites written inside a mocking library's stub or verification (STUB_WRAPPERS above).
    q(sql, params) -> rows. Only the files holding a wrapper-named call site are read."""
    names = {n for lang in STUB_WRAPPERS.values() for k in ('arg', 'prefix', 'prefix_after_do', 'recv') for n in lang[k]}
    files = sorted({f for f, n in q("SELECT DISTINCT file_path, callee_name FROM call_sites WHERE callee_name IS NOT NULL", ())
                    if _stub_lang(f) and _short(n) in names})
    out = set()
    for f in files:
        lang = STUB_WRAPPERS[_stub_lang(f)]
        rows = [(r[0], _short(r[1]), (r[2], r[3], r[4], r[5]), bool(r[6]), bool(r[7])) for r in q(
            """SELECT s.id, s.callee_name, s.start_line, s.start_column, s.end_line, s.end_column,
                      EXISTS (SELECT 1 FROM call_edges e WHERE e.call_site_id = s.id AND e.callee_provenance = 'client'
                              AND e.callee_method_id IS NOT NULL),
                      EXISTS (SELECT 1 FROM symbols y WHERE y.id = s.caller_id AND y.display LIKE '%<lambda>%')
               FROM call_sites s WHERE s.file_path = ?""", (f,)) if None not in r[2:6]]
        spans = [(i, sp) for i, _, sp, _, _ in rows]
        in_lambda = {i for i, _, _, _, lam in rows if lam}
        wraps = [(n, sp) for _, n, sp, client, _ in rows if not client]      # the LIBRARY's wrapper, never a project method
        def outermost(cands):               # the candidates no other candidate encloses
            return {i for i, sp in cands if not any(_within(sp, o) for _, o in cands)}
        def nearest(cands):                 # the candidates enclosing no other candidate
            return {i for i, sp in cands if not any(_within(o, sp) for _, o in cands)}
        for n, w in wraps:
            if n in lang['arg']:
                # inside the wrapper's span and NOT inside its receiver chain, which starts where the wrapper starts:
                # `given().body(new HashMap<>() {…}).when().put("/orders/1")` holds the HashMap inside `when`'s span, as
                # the receiver's argument, not as when's
                recv = [sp for _, sp in spans if _within(sp, w) and sp[:2] == w[:2]]
                out |= outermost([(i, sp) for i, sp in spans if _within(sp, w) and sp[:2] > w[:2]
                                  and not any(sp == r or _within(sp, r) for r in recv)
                                  and (i in in_lambda or not lang['lambda_arg'])])
            if n in lang['prefix'] or (n in lang['prefix_after_do'] and
                                       any(x in STUB_DO and _within(sp, w) and sp[:2] == w[:2] for x, sp in wraps)):
                out |= nearest([(i, sp) for i, sp in spans if _within(w, sp) and sp[:2] == w[:2]])
            if n in lang['recv']:
                out |= outermost([(i, sp) for i, sp in spans if _within(sp, w) and sp[:2] == w[:2]])
    return out


# ── a MOCKED TYPE: a test class that holds a mock of T never runs T's methods ────────────────────────────────────
# `@MockBean OrderService orders` in a web test replaces the bean the controller is handed, so a request the test sends
# reaches the controller and stops at the mock: a change to OrderService's body cannot fail that test, however the
# route to it is drawn. Read off the test class's FIELDS (and those of the classes it extends): a mock-making
# annotation on the field, a Moq `Mock<T>` field type, or a mock factory written in the field's initializer. A spy
# (@Spy, @SpyBean, Substitute.ForPartsOf) runs the real methods and is not a mock here; neither is @InjectMocks, the
# object under test. A mock held in a LOCAL is not read (no fact records a local's initializer), so a test that builds
# its mocks inside the method keeps its routes.
MOCK_FIELD_DECOR = {'Mock', 'MockBean', 'MockitoBean'}
MOCK_FACTORY = {'mock', 'For', 'Fake'}                     # Mockito.mock(T.class), Substitute.For<T>(), A.Fake<T>()
_MOCK_GENERIC = re.compile(r'^(?:\w+\.)*Mock<\s*([\w.]+)')


def _simple_type(t):
    return re.sub(r'<.*$', '', (t or '').strip()).split('.')[-1]


def mocked_types(q, line_of=None):
    """{test type simple name: {mocked type simple name}} from the fields a test class declares. q(sql, params);
    line_of(file, line) -> the source line, read only where the parser kept `Mock` and dropped its type argument (C#)."""
    try:
        fields = q("SELECT id, type_name, owner_qualified_name, file_path, start_line FROM fields WHERE owner_qualified_name IS NOT NULL", ())
    except Exception:
        return {}
    dec = collections.defaultdict(set)
    for oid, name in q("SELECT owner_id, name FROM decorations WHERE owner_id IS NOT NULL", ()):
        dec[oid].add((name or '').split('.')[-1])
    fac = collections.defaultdict(set)
    for f, l, n in q("SELECT file_path, start_line, callee_name FROM call_sites WHERE callee_name IS NOT NULL", ()):
        if _short(n) in MOCK_FACTORY: fac[(f, l)].add(_short(n))
    out = collections.defaultdict(set)
    for fid, tn, owner, f, l in fields:
        m = _MOCK_GENERIC.match(tn or '')
        if not m and _simple_type(tn) == 'Mock' and line_of and f and l:
            m = re.search(r'\bMock<\s*([\w.]+)', line_of(f, l) or '')
        t = m.group(1).split('.')[-1] if m else (_simple_type(tn) if (dec.get(fid, set()) & MOCK_FIELD_DECOR or fac.get((f, l))) else None)
        if t: out[owner.split('.')[-1]].add(t)
    return dict(out)


def best_cert(certs):
    return min(certs, key=lambda c: DIRECT_ORDER.index(c) if c in DIRECT_ORDER else len(DIRECT_ORDER))


def direct_cert(tier):
    """how sure a DIRECT dependent row is, from the edge's tier."""
    return DIRECT_CERT.get(tier, DIRECT_CERT_DEFAULT)


def site_lines(start, end, cap=40):
    """every line a call site spans. A chained call (`router\\n  .route('/')\\n  .post(h)`) records its edges on the
    statement's first line while an argument sits on a later one. Capped: a site spanning a whole callback body is
    not a hand-off on every line of it."""
    start = start or 0
    if not end or end <= start or end - start > cap: return [start]
    return list(range(start, end + 1))


def dispatch_live_sql(has_literals):
    """The WHERE fragment (aliases `dc` = dispatch_candidates, `m` = methods) that keeps a base -> override dispatch pair
    in the walk: the override's owner type can exist at run time. One copy for the path export and both fast-path walks,
    so the rules and the fast path narrow alike.

    Rapid type analysis keeps an override only when its owner is CONSTRUCTED somewhere (type_instantiated). A class that
    is loaded by its dotted name is constructed with no construction site the graph can see: `"pkg.mod.Class"` in a
    registry, turned into the class by import_module/getattr (or Class.forName, or a settings entry) and then called.
    Dropping those overrides cut every test walk at the base's dispatch hop, while `impact` on the override itself listed
    the base's caller as [one of a set]: the direct row and the walk disagreed about the same hop. The pair is kept, as a
    dispatch choice like any other, when the owner's full qualified name (it must contain a dot, so a bare class name
    written as a word does not count) is written as a string literal somewhere in the repository."""
    by_name = (" OR m.owner_type_id IN (SELECT type_id FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL"
               " AND instr(qualified_name, '.') > 0 AND qualified_name IN (SELECT value FROM literals))") if has_literals else ""
    return ("(dc.basis = 'value' OR m.owner_type_id IS NULL OR m.owner_type_id IN (SELECT type_id FROM type_instantiated)"
            f"{by_name} OR NOT EXISTS (SELECT 1 FROM type_instantiated))")


_LOCAL_KINDS, _SCOPE_KINDS = ('function', 'method'), ('function', 'method', 'constructor')


def local_scopes(q, ids):
    """{id: (file, start, end, enclosing id)} for each declaration in `ids` that is a def NESTED in another callable: the
    rules' `local_def` (dl/impact.dl), read off the same spans `lex_parent` is (the innermost declaration whose span holds
    it is a function, method or constructor). Its name is bound in that def only, so a reference or an untyped call
    written with the name anywhere else names some other binding."""
    out = {}
    for m in ids:
        r = q("SELECT file, line, end_line, kind FROM symbols WHERE id=?", m)
        if not r or r[0][3] not in _LOCAL_KINDS or not r[0][0] or not r[0][1]: continue
        f, a, b = r[0][0], r[0][1], r[0][2] or r[0][1]
        around = [x for x in q("SELECT id, kind, line, end_line FROM symbols WHERE file=? AND line<=? AND end_line>=? AND id<>?", f, a, b, m)
                  if x[2] and x[3] and (x[2], x[3]) != (a, b)]
        if not around: continue
        p = max(around, key=lambda x: (x[2], -x[3]))
        if p[1] in _SCOPE_KINDS: out[m] = (f, p[2], p[3], p[0])
    return out


def sees_local(q, scope, c):
    """c is the def `scope` (from local_scopes) encloses, or is written inside it: the rules' `c = p ; lex_in(p, c)`."""
    f, a, b, p = scope
    if c == p: return True
    r = q("SELECT file, line, end_line FROM symbols WHERE id=?", c)
    return bool(r) and r[0][0] == f and a <= (r[0][1] or 0) and (r[0][2] or r[0][1] or 0) <= b


DECORATED_CALL = 'decorated_call'


def decorated_calls(q, stubs=frozenset()):
    """[(call site, caller, decorated def, raw file, line)]: a call written with the name of a def a project decorator
    wraps. `@audited def summarise` rebinds `summarise` to what audited returned, so the engine resolves `summarise(xs)`
    to the WRAPPER (ext_decorated_name_target holds the rebinding) and the wrapper's own `f(...)` fans out to every def
    that decorator wraps. Read edge by edge, the caller reached the wrapper and then one of a set, and `impact summarise`
    listed the caller as "[by name] names it as a value": the call it writes was taken for a reference. The site names
    the decorated def and the engine resolved it to that def's wrapper, so this is the call to it, through the wrapper.
    A site whose name matches more than one def rebound to the same wrapper keeps the one declared in its own file, and
    is dropped when that does not settle it. Ids are the engine's method ids, as in call_edges."""
    if not all(_t in {r[0] for r in q("SELECT name FROM sqlite_master")} for _t in ('ext_decorated_name_target', 'call_sites', 'methods')):
        return []
    by = collections.defaultdict(set); where = {}
    for sid, c, d, f, l, cf, dfile in q("""SELECT e.call_site_id, e.caller_id, t.c0, s.file_path, s.start_line, sc.file, sd.file
              FROM call_edges e JOIN call_sites s ON s.id = e.call_site_id
              JOIN ext_decorated_name_target t ON t.c1 = e.callee_method_id AND t.c0 <> t.c1
              JOIN methods m ON m.id = t.c0 AND m.name = s.callee_name
              JOIN symbols sd ON sd.method_id = t.c0 LEFT JOIN symbols sc ON sc.id = e.caller_id
              WHERE e.callee_provenance = 'client'"""):
        if sid in stubs or not c or not d or c == d: continue
        by[sid].add((d, dfile)); where[sid] = (c, f, l, cf)
    out = []
    for sid, ds in sorted(by.items()):
        c, f, l, cf = where[sid]
        pick = {d for d, _ in ds} if len(ds) == 1 else {d for d, df in ds if df and df == cf}
        if len(pick) == 1: out.append((sid, c, next(iter(pick)), f, l or 0))
    return out
