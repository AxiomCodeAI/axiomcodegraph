"""What will call a declaration that no call site calls — the registration conventions, in one place.

A handler is handed to a framework as a VALUE: `app.get('/orders/:id', getOrder)`, `background.add_task(send_receipt,
id)`, `setTimeout(flush, 1000)`, `handlers = {"x": handle_x}`. The call then happens inside the framework, or later, or
never, so there is no call site for it anywhere in the graph — and every rule that answers "who uses this method" is
about call sites. The reference the parser recorded is the only evidence there is, and what that reference MEANS is a
convention, which is why it lives here in a table rather than inside a rule.

Both backends read this module, so the Datalog side (the `registration` input facts of dl/impact.dl) and the SQL side
(graph_sql.direct_for_method) cannot drift apart on what counts as a registration.

A route registration is NOT recognised by the verb alone. `get`, `set`, `delete`, `head` and `options` are Map, Set,
Headers, Reflect, URLSearchParams and every cache in this ecosystem, so the site must ALSO carry a string that looks
like a path — one that begins with `/`. That is the discriminator the engine's own TypeScript rules use, and it is
what keeps `cache.get(key)` out of the answer. Everything else that takes the declaration as an argument is reported
as a callback, which claims only what is written: this call receives it, and calls it where the graph cannot follow.
"""

ROUTE_VERB = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'connect', 'all', 'use', 'route'}

# ── what takes a callable and calls it later ────────────────────────────────────────────────────────────────
# The second convention list, and it exists because the first measurement said it had to. Treating EVERY call that
# a declaration's name appears at as "handed over as a callback" labelled 13,976 lines of one 124-file Express
# application, and 3,549 of the references on those lines were names that merely COINCIDE with a declared callable
# — `length` 262 times, `text` 124, `jQuery` 417. A name match on an arbitrary call line is not evidence that the
# declaration was handed over; a call whose whole purpose is to take a callable is.
#
# Timers, event registration, promise continuations, the iteration protocol, and the scheduling verbs. Kept to what
# is unambiguous across ecosystems; a name that is also an ordinary accessor (`set`, `add`, `push`) is deliberately
# absent, because the cost of a wrong row here is a dependent that does not exist.
CALLBACK_TAKER = {
    'settimeout', 'setinterval', 'setimmediate', 'requestanimationframe', 'queuemicrotask', 'nexttick', 'defer',
    'on', 'once', 'addlistener', 'prependlistener', 'addeventlistener', 'removelistener', 'removeeventlistener',
    'subscribe', 'unsubscribe', 'observe', 'watch', 'listen', 'hook', 'addhook', 'tap',
    'then', 'catch', 'finally',
    'foreach', 'map', 'filter', 'reduce', 'flatmap', 'sort', 'some', 'every', 'find', 'findindex',
    'register', 'addhandler', 'addroute', 'middleware', 'use',
    'add_task', 'addtask', 'enqueue', 'schedule', 'submit', 'apply_async', 'delay',
}

# the entity kinds a parser gives an identifier that binds to a callable. IMPORT_BINDING is here because a handler is
# usually imported from the module that declares it, and the reference at the registration is then recorded as the
# import binding rather than as a method; an import binding is recorded at the USE, not at the import statement, so
# this does not turn every import line into a dependent.
CALLABLE_EK = ('METHOD', 'FUNCTION', 'IMPORT_BINDING')

MAX_SITE_SPAN = 200          # a "call" spanning a whole file is a parse artefact, not a registration


def registrations(q, site_file=None):
    """[(file, line, kind, key, why)] — every line that hands a declaration to something outside the graph.

    `kind` is "route" or "callback"; `key` is the string the framework dispatches on, VERBATIM and never normalised
    (`/orders/:id`), empty when there is none. The key is what lets a test that drives the app through the framework's
    client (`supertest.get('/orders/1')`, `TestClient(app).post('/orders')`) be joined to the handler it reaches: the
    two ends spell the same string and nothing else connects them. Normalising it belongs in the join, not here —
    `:id`, `{order_id}` and `<int:id>` are three frameworks' spellings of one hole.
    """
    if not _has(q, 'call_sites'):
        return []
    sf = site_file or (lambda x: x)
    lits = {}
    if _has(q, 'literals'):
        for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
            lits.setdefault((f, l), []).append(v)
    # the declarations a name identifies uniquely: only those can be named as the registered declaration, because
    # a site names a VALUE by identifier and two callables of one name would each claim the other's registration
    once = {}
    for n, i, c in q("""SELECT name, min(id), count(*) FROM symbols WHERE method_id IS NOT NULL AND name IS NOT NULL
                        AND name NOT LIKE '<%' GROUP BY name"""):
        if c == 1: once[n] = i
    ref_at = {}
    if _has(q, 'refs'):
        ek = ','.join('?' * len(CALLABLE_EK))
        for n, f, l in q(f"SELECT name, file, line FROM refs WHERE line > 0 AND entity_kind IN ({ek})", *CALLABLE_EK):
            if n in once: ref_at.setdefault((f, l), once[n])
    out = {}
    for name, site_kind, fp, a, b in q("""SELECT callee_name, kind, file_path, start_line, end_line FROM call_sites
                                      WHERE callee_name IS NOT NULL AND start_line > 0"""):
        f = sf(fp); b = b or a
        if b < a or b - a > MAX_SITE_SPAN:
            continue
        if site_kind == 'DECORATOR_CALL':
            continue                       # a decoration is reported as a decoration, not as a registration
        short = (name or '').split('.')[-1]
        paths = [v for l in range(a, b + 1) for v in lits.get((f, l), ()) if isinstance(v, str) and v.startswith('/')]
        if short.lower() in ROUTE_VERB and paths:
            kind, key = 'route', paths[0]
            why = f'registered as a {short.upper()} route "{paths[0]}" here — the router calls it, no call site does'
        elif short.lower() in CALLBACK_TAKER:
            kind, key = 'callback', ''
            why = f'handed to {short}(…) as a callback — that call receives it and calls it where the graph cannot follow'
        else:
            continue                       # no evidence that this call does anything with a declaration named here
        for l in range(a, b + 1):
            # a route beats a plain callback on the same line: `router.use('/x', wrap(handler))` is a route site
            if (f, l) not in out or kind == 'route':
                out[(f, l)] = (kind, key, why)
    return sorted((ref_at.get((f, l), ''), f, l, k, key, w) for (f, l), (k, key, w) in out.items())


def value_ref_rows(q, names, ids, site_file=None, at=None, lines=None):
    """The SQL side of the rule: [(caller, 'uses', why, 'by name', file, line)] for a method target.

    Guards, the same two the Datalog rule carries: a reference at a line that also holds a call of that name is the
    call, not a value (a language that emits a reference row for the callee of `foo()` as well — Python does — would
    otherwise double every call); and the target's own declaration is never its own dependent.
    """
    if not names or not _has(q, 'refs'):
        return []
    import re
    sf = site_file or (lambda x: x)
    reg = {(f, l): w for _d, f, l, _k, _key, w in registrations(q, sf)}
    called = set()
    for n in names:
        for fp, l in q("SELECT file_path, start_line FROM call_sites WHERE callee_name = ? AND start_line > 0", n):
            called.add((n, sf(fp), l))
    ek = ','.join('?' * len(CALLABLE_EK))
    rows, idset = [], set(ids)
    for n in names:
        # the parser's vocabulary where there is one, and the registration site where there is not: a JavaScript
        # graph's entity_kind is the access mode (READ / WRITE), so CALLABLE_EK matches nothing and only the site
        # identifies a value that is handed over
        # only where the parser says the identifier binds to a callable. A site-evidence leg for the languages that
        # carry no entity kind was tried and measured: eleven rows on a real application, all eleven wrong. See the
        # note in dl/impact.dl next to `valueref`.
        hits = set(q(f"SELECT file, line FROM refs WHERE name = ? AND line > 0 AND entity_kind IN ({ek})", n, *CALLABLE_EK))
        for f, l in sorted(hits):
            if (n, f, l) in called:
                continue
            c = at(f, l) if at else None
            if not c or c in idset:
                continue
            rows.append((c, 'uses', reg.get((f, l), _PLAIN), 'by name', f or '', l or 0))
    return rows


QUALIFIED_REF_KINDS = ('FIELD_ACCESS', 'PROPERTY_ACCESS', 'ATTRIBUTE_ACCESS')


def _is_receiver(q, lines, f, l, n):
    """n is written as `n.<something>` on this line, for a qualified reference the exporter also records there."""
    import re
    L = lines(f) or []
    text = L[l - 1] if 0 < l <= len(L) else ''
    if not text:
        return False
    for (m,) in q("SELECT name FROM refs WHERE file = ? AND line = ? AND kind IN (?,?,?)", f, l, *QUALIFIED_REF_KINDS):
        if re.search(rf'([A-Za-z_$][\w$]*)\s*\.\s*{re.escape(m)}\b', text or ''):
            for qn in re.findall(rf'([A-Za-z_$][\w$]*)\s*\.\s*{re.escape(m)}\b', text):
                if qn == n:
                    return True
    return False


_PLAIN = 'names it as a value — passed, stored or registered, and called somewhere the graph cannot see'


# A value reference is a dependent, but it is NOT a by-name CALL, so it must not seed the upward closure: handing a
# handler to a router is not calling it, and whoever reaches the registering module does not thereby reach the
# handler. The rules get this right for free (`seed_byname` reads unresolved CALL SITES only); the SQL port builds
# its by-name seeds from the direct rows, so it has to tell the two apart, and this is how.
def is_value_why(why):
    w = why or ''
    return w.startswith('names it as a value') or w.startswith('registered as a') or w.startswith('handed to ')


def _has(q, t):
    return bool(q("SELECT 1 FROM sqlite_master WHERE name=?", t))
