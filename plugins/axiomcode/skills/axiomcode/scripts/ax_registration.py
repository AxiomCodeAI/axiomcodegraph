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
what keeps `cache.get(key)` out of the answer. A declaration handed to anything else is not given a registration
here: the reference alone says it is passed as a value (`valueref` in dl/impact.dl), and naming the receiving call as
one that "calls it where the graph cannot follow" was wrong for every synchronous collection operation (#1166).
"""
import re

ROUTE_VERB = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace', 'connect', 'all', 'use', 'route'}
# the verbs that name an HTTP method; `all`, `use` and `route` register or mount without naming one
HTTP_VERB = ROUTE_VERB - {'all', 'use', 'route'}

# A CALLBACK IS NOT RECOGNISED BY THE VERB ALONE, and a curated list of verbs was the wrong instrument.
# The route leg has two independent signals -- an HTTP verb AND a path-shaped literal on the same line -- and it is
# the pair that carries it. The callback leg had one: the name of the method being called, matched against a list
# this file maintained by hand. That list had to grow with every framework in every ecosystem, and it was wrong in
# the common case rather than the rare one. Measured on a JVM framework of ~8,600 files it produced 5,361 rows, of
# which forEach (1347), map (1065), filter (586), find (164), flatMap (150) and sort (61) are synchronous
# collection operations: the callable is invoked on that line, in that thread, before the call returns. Each of
# those rows told the reader "that call receives it and calls it where the graph cannot follow", which is the
# opposite of what the code does -- about two thirds of the leg, stated confidently and backwards.
#
# The evidence a registration needs is that a declaration is handed over AS A VALUE, and the graph already records
# that independently of any name: `valueref` in dl/impact.dl, and `refs` with a callable entity kind here. The
# `registered` rule is a join on that reference, so the verb list was a second gate on top of the real signal, not
# the signal itself -- removing it drops the rows that rested on the name alone and keeps the ones the reference
# carries. Route registrations, decoration keys and value-route registrations are untouched: each of those has a
# second signal that does not come from a hand-written vocabulary.

# the entity kinds a parser gives an identifier that binds to a callable. IMPORT_BINDING is here because a handler is
# usually imported from the module that declares it, and the reference at the registration is then recorded as the
# import binding rather than as a method; an import binding is recorded at the USE, not at the import statement, so
# this does not turn every import line into a dependent.
CALLABLE_EK = ('METHOD', 'FUNCTION', 'IMPORT_BINDING')

MAX_SITE_SPAN = 200          # a "call" spanning a whole file is a parse artefact, not a registration


def registrations(q, site_file=None):
    """[(file, line, kind, key, why)] — every line that hands a declaration to something outside the graph.

    `kind` is always "route"; `key` is the string the framework dispatches on, VERBATIM and never normalised
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
    # a route mounted INSIDE A TEST is a fixture, not the application's dispatch table, and its key must not be
    # joinable. Measured on a TypeScript router library: all 6,128 of its route registration lines are in test
    # files, and the keys repeat — `/` 1,403 times, `/:id` 415, `/test` 248. The caps refuse a key that is too WIDE,
    # so they catch those three; a fixture route mounted once, at a path another test happens to mention, survives
    # the cap and joins two unrelated tests. The DEPENDENT row is still true and still printed — a test that mounts a
    # handler does depend on it — so only the key is withheld.
    tf = {f for (f,) in q("SELECT DISTINCT file FROM symbols WHERE is_test = 1 AND file IS NOT NULL")} if _has(q, 'symbols') else set()
    out, verbs, _own = _route_links(q, sf, lits, tf)
    # `router.route('/').get(h)` is two route-shaped calls on one line, and `route` said nothing about the method: the
    # line's HTTP verbs name it, in the order written. A chain registering two (`.get(a).post(b)`) names both, because
    # a line is all a reference records and it cannot say which argument list the handler sat in
    for (f, l), (k, key, w) in list(out.items()):
        vs = verbs.get((f, l))
        if k == 'route' and vs:
            m = re.match(r'registered as a \w+ route (".*?") here', w)
            if m: out[(f, l)] = (k, key, f"registered as a {'/'.join(sorted(vs, key=vs.get))} route {m.group(1)} here — the router calls it, no call site does")
    return sorted((ref_at.get((f, l), ''), f, l, k, key, w) for (f, l), (k, key, w) in out.items())


def route_site_lines(q, site_file=None):
    """{call_site_id: line} — the line a CHAINED route link's own part is written on, for each link after the first.

    A call site's start line is where its receiver starts, so the engine places the handler of `.post('/c', h3)` in
    `router.get('/a', h1)\\n.get('/b', h2)\\n.post('/c', h3)` on the chain's first line, where the registration rows say
    GET "/a". The `calls` fact and the SQL rows place an edge at one of these sites on this line instead, the line
    `registrations()` labels with the link's own verb and path. Only route links move; every other site keeps its line.
    """
    if not _has(q, 'call_sites'):
        return {}
    lits = {}
    if _has(q, 'literals'):
        for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
            lits.setdefault((f, l), []).append(v)
    return _route_links(q, site_file or (lambda x: x), lits, set())[2]


def _route_links(q, sf, lits, tf):
    """({(file, line): (kind, key, why)}, {(file, line): {HTTP verb: column}}, {call_site_id: own line}) for every
    route registration site.

    A CHAINED REGISTRATION `router.get('/a', h1).get('/b', h2).post('/c', h3)` is three call sites that all START
    where `router` starts: each one's span covers its receiver, i.e. every call before it in the chain. Reading a
    site's verb and path over its whole span gave each link the first link's path, and whichever link was read last
    claimed every line. A link's OWN part begins where its receiver ends, so the chain is walked innermost first and
    each link takes the first path its own part holds that an earlier link has not taken; a link with no path of its
    own (`router.route('/p').get(h).put(h2)`) keeps its receiver's, which is what that API means.
    """
    sites = []
    for sid, name, site_kind, fp, a, ac, b, bc in q("""SELECT id, callee_name, kind, file_path, start_line, start_column,
                                                      end_line, end_column FROM call_sites
                                                      WHERE callee_name IS NOT NULL AND start_line > 0"""):
        b = b or a
        if b < a or b - a > MAX_SITE_SPAN:
            continue
        if site_kind == 'DECORATOR_CALL':
            continue                       # a decoration is reported as a decoration, not as a registration
        sites.append((sf(fp), a, ac, b, bc, (name or '').split('.')[-1], sid))
    chains = {}
    for s in sites:
        # without a start column two calls on one line cannot be told apart from a chain: each is its own chain
        chains.setdefault((s[0], s[1], s[2]) if s[2] is not None else s, []).append(s)
    out, owned, own_line = {}, set(), {}
    verbs = {}                             # (file, line) -> {HTTP verb: first column}, for registrations' wording
    read, handlers = _source_reader(q), None
    for links in chains.values():
        links.sort(key=lambda s: (s[3], s[4] or 0))
        taken, prev_end, prev_path = set(), None, None
        for f, a, _ac, b, col, short, sid in links:
            lo = a if prev_end is None else prev_end
            own = [(l, i, v) for l in range(lo, b + 1) for i, v in enumerate(lits.get((f, l), ()))
                   if isinstance(v, str) and v.startswith('/') and (l, i) not in taken]
            args = _own_args(read(f), a, _ac, b, col) if short.lower() in ROUTE_VERB else None
            if args is not None:
                # THE CALL'S OWN ARGUMENTS, READ FROM THE SOURCE. A path literal on the same line is not evidence:
                # `checkD(request.cookies.get('t')) … redirect('/login')` put redirect's path on the `get`, and
                # `axios.get('/api/items').then(renderItems)` is a request that hands nothing to anyone. The path must
                # be one of this call's arguments, and a call named for an HTTP method must also hand over something
                # that can be called: a function, a declared name, a wrapper call, an array of those
                mine = [(s, l) for s, _t, l in args if s]
                own = [(l, i, v) for l, i, v in own if (v, l) in mine][:1] or [(l, -1, s) for s, l in mine[:1]]
                if handlers is None:
                    handlers = {n for (n,) in q("SELECT DISTINCT name FROM symbols WHERE name IS NOT NULL")} if _has(q, 'symbols') else set()
                if short.lower() in HTTP_VERB and not any(_hands_over(t, handlers) for s, t, _l in args if not s):
                    prev_end, prev_path = b, None
                    continue               # a request (a client, a Map, Headers): nothing is registered here
            if own:
                l0, i0, path = own[0]
                taken.add((l0, i0))
            else:
                # no path of its own: the link's own part starts on the line after its receiver's, when it has one
                l0, path = (min(lo + 1, b) if prev_end is not None else a), prev_path
            chained, prev_end, prev_path = prev_end is not None, b, path
            if short.lower() not in ROUTE_VERB or path is None:
                continue                   # no evidence that this call does anything with a declaration named here
            if chained:
                own_line[sid] = l0
            kind, key = 'route', ('' if f in tf else path)
            why = f'registered as a {short.upper()} route "{path}" here — the router calls it, no call site does'
            # a line shared by two links belongs to the verb whose own part starts on it, else to the outer link: on a
            # chain written on one line nothing tells the links apart, and the line keeps the last verb it always had.
            # `route(p)` registers no handler, so it never holds a line against the verbs chained onto it
            owns = short.lower() != 'route' and (not chained or l0 > lo)
            for l in range(lo, b + 1):
                if (f, l) not in owned:
                    out[(f, l)] = (kind, key, why)
                    if owns and l == l0: owned.add((f, l))
                if short.lower() in HTTP_VERB and (l == b or lo == b):
                    vs = verbs.setdefault((f, l), {}); vs[short.upper()] = min(vs.get(short.upper(), col or 0), col or 0)
    return out, verbs, own_line


def _source_reader(q):
    """file -> [line] as indexed, from the repository index_meta names; None where it cannot be read. A graph
    whose source is not there (copied elsewhere, or read without its tree) keeps the line-only reading."""
    import os
    roots = []
    if _has(q, 'index_meta'):
        roots = [v for k in ('repo', 'source_dir') for (v,) in q("SELECT value FROM index_meta WHERE key = ?", k) if v]
    cache = {}

    def read(f):
        if f not in cache:
            cache[f] = None
            for p in ([f] if os.path.isabs(f or '') else [os.path.join(r, f) for r in roots if f]):
                try:
                    with open(p, errors='replace') as h: cache[f] = h.read().split('\n'); break
                except OSError:
                    pass
        return cache[f]
    return read


def _blank(t):
    """t with the insides of string literals and comments blanked (same length, quotes kept)"""
    out, i, n = list(t), 0, len(t)
    while i < n:
        c = t[i]
        if c in '\'"`':
            j = i + 1
            while j < n and t[j] != c and (c == '`' or t[j] != '\n'):
                if t[j] == '\\': out[j] = ' '; j += 1
                if j < n and t[j] != '\n': out[j] = ' '
                j += 1
            i = j + 1
        elif t.startswith('//', i):
            j = t.find('\n', i); j = n if j < 0 else j
            for k in range(i, j): out[k] = ' '
            i = j
        elif t.startswith('/*', i):
            j = t.find('*/', i + 2); j = n if j < 0 else j + 2
            for k in range(i, j):
                if t[k] != '\n': out[k] = ' '
            i = j
        else:
            i += 1
    return ''.join(out)


def _own_args(L, a, ac, b, bc):
    """[(path or None, argument text, line)] of the call site's OWN argument list — the last one, ending at its end
    column — or None when the source does not hold a call there (not readable, or edited since it was indexed)."""
    if not L or not bc or not ac or b > len(L) or a < 1:
        return None
    chunk = [L[a - 1][ac - 1:]] + L[a:b] if b > a else [L[a - 1][ac - 1:bc - 1]]
    if b > a: chunk[-1] = chunk[-1][:bc - 1]
    text = '\n'.join(chunk); blank = _blank(text)
    close = len(blank) - 1
    if close < 0 or blank[close] != ')':
        return None
    d, j = 0, close
    while j >= 0:
        if blank[j] in _CLOSE: d += 1
        elif blank[j] in _OPEN:
            d -= 1
            if d == 0: break
        j -= 1
    if j < 0:
        return None
    out = []
    for lo, hi in _split_args(blank, j + 1, close):
        t = text[lo:hi].strip()
        # the path argument: a string beginning with `/` written in it outside any bracket — `'/items'`, and the
        # prefixed `path + '/:id'` a resource helper composes — never one inside a nested call's own arguments
        path, at, d = None, lo + len(text[lo:hi]) - len(text[lo:hi].lstrip()), 0
        for k in range(lo, hi):
            c = blank[k]
            if c in _OPEN: d += 1
            elif c in _CLOSE: d -= 1
            elif c in '\'"`' and d == 0:
                m = re.match(r'([\'"`])(/[^\'"`\n]*)\1', text[k:hi])
                if m: path, at = m.group(2), k
                break
        out.append((path, t, a + text.count('\n', 0, at)))
    return out


def _hands_over(t, names):
    """the argument text can be something a router calls: a function, a name the graph declares, a call (a wrapper or a
    middleware factory), an array of those. A string, a number, an object, `new X()` or a name nothing declares (a
    parameter, a local: the request's data) is not."""
    t = t.strip()
    if not t or t[0] in '\'"`{' or t[0].isdigit() or re.match(r'(new|true|false|null|undefined)\b', t):
        return False
    if t.startswith('...') or _fn_literal(t):
        return True
    if t.startswith('[') and t.endswith(']'):
        b = _blank(t)
        return any(_hands_over(t[lo:hi], names) for lo, hi in _split_args(b, 1, len(b) - 1))
    if _CHAIN.fullmatch(t):
        return re.split(r'\s*\??\.\s*', t)[-1] in names
    return True                           # a call, a conditional, an `await`: not read further, and kept


# A CONST HOLDING A WRAPPED HANDLER — `const h = catchAsync(async (req, res) => …)`, then `router.get('/a', h)` — is a
# field, not a method, so it has no call edge of its own to carry the route wording. What both backends join instead
# (`const_route` in dl/impact.dl, graph_sql.direct_for_field) is two facts read from the source at the call sites the
# engine recorded, and neither is "the name appears on a route line":
#
#   route_args     the name is written IN A HANDLER POSITION of the route call: a top-level argument after the path
#                  (or an element of an array argument, which a router flattens) that is a bare name or a member
#                  chain ending in it. The receiver (`router.get`), an options object (`{ schema: { 200: S } }`), an
#                  argument of a nested call (`validate(bodySchema)`, `express.static(dir)`) and the path are not
#                  handed to the router to call, and a name written there is read, not registered.
#   const_values   the const HOLDS A FUNCTION: its initializer is a function, a reference to a declared function, or
#                  a call that returns one — a callee the engine says returns a function (`returns_fn`), or a wrapper
#                  that is handed a function (`asyncHandler(async (req, res) => …)`, nested wrappers too). A plain
#                  object, a schema builder, `express.Router()`, `require(…)`, a string or a number never is: a router
#                  mounted with `app.use('/p', router)` is a mount, not a handler.

_IDENT = r'[A-Za-z_$][\w$]*'
_CHAIN = re.compile(rf'({_IDENT})(?:\s*\??\.\s*({_IDENT}))*\s*$')
_OPEN, _CLOSE = '([{', ')]}'


def _match(text, i):
    """the index just past the bracket group opening at text[i] (strings and comments are already blanked)"""
    d = 0
    for j in range(i, len(text)):
        c = text[j]
        if c in _OPEN: d += 1
        elif c in _CLOSE:
            d -= 1
            if d == 0: return j + 1
    return len(text)


def _split_args(text, lo, hi):
    """[(start, end)] of the top-level comma-separated items in text[lo:hi]"""
    out, d, s = [], 0, lo
    for j in range(lo, hi):
        c = text[j]
        if c in _OPEN: d += 1
        elif c in _CLOSE: d -= 1
        elif c == ',' and d == 0: out.append((s, j)); s = j + 1
    if text[s:hi].strip(): out.append((s, hi))
    return out


def _fn_literal(t):
    """`function …`, `async (a, b) => …`, `req => …`, `(req: Request): void => …`"""
    t = t.lstrip()
    if re.match(r'(async\s+)?function\b', t): return True
    m = re.match(r'(async\s*)?', t); t = t[m.end():]
    if re.match(rf'{_IDENT}\s*=>', t): return True
    if t.startswith('('):
        return bool(re.match(r'\s*(:[^=;{}]*)?=>', t[_match(t, 0):]))
    return False


def route_args(q, code, site_file=None):
    """{(caller, file, line, name)}: `name` written in a handler position of a route-shaped call made by `caller`."""
    if not _has(q, 'call_sites') or code is None:
        return set()
    sf = site_file or (lambda x: x)
    out = set()
    for c, name, fp, a, ac, b, bc in q("""SELECT caller_id, callee_name, file_path, start_line, start_column, end_line, end_column
                                          FROM call_sites WHERE callee_name IS NOT NULL AND start_line > 0 AND file_path IS NOT NULL"""):
        if name.split('.')[-1].lower() not in ROUTE_VERB: continue
        b = b or a
        if b < a or b - a > MAX_SITE_SPAN: continue
        f = sf(fp); L = code(f) or []
        if b > len(L): continue
        text = '\n'.join(L[a - 1:b]); starts = [0]
        for ln in L[a - 1:b - 1]: starts.append(starts[-1] + len(ln) + 1)
        end = starts[-1] + (bc - 1 if bc else len(L[b - 1]))       # end_column is one past the call's `)`
        close = text.rfind(')', 0, end)
        if close < 0: continue
        d, j = 0, close                                             # back to the `(` that opens THIS call's arguments
        while j >= 0:
            if text[j] in _CLOSE: d += 1
            elif text[j] in _OPEN:
                d -= 1
                if d == 0: break
            j -= 1
        if j < 0: continue
        line_of = lambda k: a + sum(1 for s0 in starts[1:] if s0 <= k)
        # every argument is looked at: the path is a string (blanked), and a path or prefix held in a const is not a
        # function, which `const_values` decides. `.route('/p').post(a, b)` has no path in its own argument list
        todo = _split_args(text, j + 1, close)
        while todo:
            lo, hi = todo.pop()
            t = text[lo:hi]; st = t.strip()
            if st.startswith('[') and st.endswith(']'):             # an array of handlers: the router flattens it
                k = lo + t.index('['); todo += _split_args(text, k + 1, lo + t.rindex(']')); continue
            m = _CHAIN.match(st)
            if not m or st.startswith(('...', 'new ')): continue
            last = re.search(rf'({_IDENT})\s*$', st)
            out.add((c, f, line_of(lo + t.rindex(last.group(1))), last.group(1)))
    return out


def const_values(q, code, decls, site_file=None):
    """For each (file, line, name) const declaration: ({(file, line)} that hold a function, {(file, line, wrapper)} the
    client callable its initializer calls, {(file, line, name)} the function it is an alias of)."""
    callable_, wrap, alias = set(), set(), set()
    if not decls or code is None:
        return callable_, wrap, alias
    sf = site_file or (lambda x: x)
    fns = {n for (n,) in q("SELECT DISTINCT name FROM symbols WHERE method_id IS NOT NULL AND name IS NOT NULL AND name NOT LIKE '<%'")}
    rets = {w for w, _m in returned_functions(q)}
    callee_at = {}
    for fp, l, col, m in q("""SELECT s.file_path, s.start_line, s.start_column, e.callee_method_id FROM call_sites s JOIN call_edges e
                              ON e.call_site_id = s.id WHERE e.callee_provenance = 'client' AND e.callee_method_id IS NOT NULL
                              AND s.file_path IS NOT NULL AND s.start_line > 0"""):
        callee_at.setdefault((sf(fp), l, col), set()).add(m)

    def call_value(text, i, f, a, starts, depth=0):
        """(callable?, wrappers) for the expression at text[i:]"""
        m = re.compile(rf'\s*(await\s+|new\s+)?({_IDENT}(?:\s*\??\.\s*{_IDENT})*)\s*').match(text, i)
        if not m or m.group(1): return False, set()
        k = m.end(); chain = m.group(2); k0 = m.start(2)
        ln = a + sum(1 for s0 in starts[1:] if s0 <= k0); col = k0 - starts[ln - a] + 1
        ws = callee_at.get((f, ln, col), set())
        if k >= len(text) or text[k] != '(':                          # a reference: an alias of a declared function
            last = re.split(r'\s*\??\.\s*', chain)[-1]
            return (last in fns and depth == 0 and not re.match(r'\s*[\[+\-*/%?`]', text[k:k + 2]), {('alias', last)})
        if chain.split('.')[-1].strip() in ('require', 'import'): return False, set()
        ok = bool(ws & rets); groups = 0
        while k < len(text) and text[k] == '(' and groups < 3:       # `wrap(fn)` and curried `wrap(opts)(fn)`
            e = _match(text, k); groups += 1
            for lo, hi in _split_args(text, k + 1, e - 1):
                t = text[lo:hi]
                if _fn_literal(t): ok = True
                elif depth < 3:
                    inner, _w = call_value(text, lo, f, a, starts, depth + 1)
                    if inner or (re.fullmatch(rf'\s*{_IDENT}(\s*\.\s*{_IDENT})*\s*', t) and re.split(r'\s*\.\s*', t.strip())[-1] in fns): ok = True
            k = e
            while k < len(text) and text[k] in ' \t': k += 1
        if k < len(text) and text[k] == '.': return False, set()     # `express.Router().use(…)`: a method of the result
        return ok, {('wrap', w) for w in ws}

    for f, l, n in decls:
        L = code(f) or []
        if not (0 < l <= len(L)): continue
        chunk = L[l - 1:l + 40]; text = '\n'.join(chunk); starts = [0]
        for ln in chunk[:-1]: starts.append(starts[-1] + len(ln) + 1)
        m = re.search(rf'(?<![\w$.]){re.escape(n)}\s*(?::[^=;\n]*)?=(?![=>])', text[:len(chunk[0])])
        if not m: continue
        if _fn_literal(text[m.end():]): callable_.add((f, l)); continue
        ok, how = call_value(text, m.end(), f, l, starts)
        if ok: callable_.add((f, l))
        for kind, x in how:
            if kind == 'wrap': wrap.add((f, l, x))
            elif ok: alias.add((f, l, x))
    return callable_, wrap, alias


def returned_functions(q):
    """{(wrapper, fn)}: the engine's own `ext_return_value` — the function a callable returns. `catchAsync` returns
    `(req, res, next) => …`, and that is the function the route line hands over for every const it wrapped."""
    if not _has(q, 'ext_return_value'):
        return set()
    return {(w, m) for w, k, m in q("SELECT c0, c1, c2 FROM ext_return_value") if k == 'func' and m}


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
        hits = {tuple(r) for r in q(f"SELECT file, line FROM refs WHERE name = ? AND line > 0 AND entity_kind IN ({ek})", n, *CALLABLE_EK)}   # rows, as tuples: a sqlite3.Row does not sort
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


# ── the DECORATION path: the key is written at the `@`, and the owner is recorded ────────────────────────────
# `registrations()` above skips DECORATOR_CALL sites deliberately, because a decoration is not a call that hands a
# value over. It is the other half of the same idea and it carries BETTER evidence: the index records which
# declaration a decoration is on, so the registered declaration needs no name matching at all.
#
#     @router.post("/orders")          key "/orders"          a route
#     @cli.command("price")            key "price"            a command name
#     @receiver("order_created")       key "order_created"    a signal
#     @exporter("csv")                 key "csv"              a table entry
#
# Every one of those is "the framework will dispatch to this declaration when someone writes this string", which is
# exactly what the join needs. The kind is read from the key rather than from a list of decoration names: a key that
# begins with `/` is a route, anything else is a key, and no framework is named anywhere in this function.
def decoration_key_strings(text):
    """the strings a decoration's text registers its declaration under, sorted: every quoted string in it but prose.
    A STRING WITH A SPACE IN IT IS PROSE, NOT A KEY: `@widgets.doc("Endpoint to list the widgets")`, `@Operation(summary = "List
    the orders")`, a cron expression, a query. No route, command, signal or table name is written with one, and read as
    a key the description was printed as what the framework dispatches on."""
    out = set()
    for a, b in re.findall(r'"([^"]{1,120})"|\'([^\']{1,120})\'', text or ''):
        key = a or b
        if key and not re.search(r'\s', key): out.add(key)
    return sorted(out)


def decoration_keys(q, site_file=None):
    """[(decl, file, line, kind, key, why)] — a declaration registered under a string by its own decoration."""
    if not _has(q, 'decorations'):
        return []
    import re
    sf = site_file or (lambda x: x)
    # A DECORATION ON A TEST CARRIES DATA, NOT A REGISTRATION. `@ValueSource(strings = {"/htmltests/large.html"})`,
    # `@CsvSource`, `@pytest.mark.parametrize`, `@DisplayName` — the strings are the test's inputs, and reading them
    # as keys let every test that mentions the same string reach that test method. Measured on the JVM parser: 27 by-key
    # edges from one `@ValueSource` of resource paths. A route handler, a signal receiver or a CLI command is
    # production code; nothing is lost by declining to read a test's own decoration as a registration.
    tests = {r[0] for r in q("SELECT id FROM symbols WHERE is_test = 1")} if _has(q, 'symbols') else set()
    out = []
    for owner, name, text, f, l in q("""SELECT owner_id, name, text, file, line FROM decorations
                                        WHERE text IS NOT NULL AND text <> '' AND owner_id IS NOT NULL"""):
        if owner in tests:
            continue
        short = (name or '').split('.')[-1]
        for key in decoration_key_strings(text):
            kind = 'route' if key.startswith('/') else 'key'
            why = (f'registered as a route "{key}" by @{short} — the router calls it, no call site does' if kind == 'route'
                   else f'registered under "{key}" by @{short} — whoever writes that string reaches it, and no call site does')
            out.append((owner, sf(f) if f else '', l or 0, kind, key, why))
    out += _prefixed_routes(q, out, sf)
    return sorted(set(out))


# A HANDLER'S ROUTE IS ITS TYPE'S PREFIX AND ITS OWN PATH. `@RequestMapping("/orders/{id}")` on the class and a bare
# `@GetMapping` on the method serve "/orders/{id}"; `@PostMapping("lines")` beside it serves "/orders/{id}/lines"; a
# path written without its leading slash (`@RequestMapping("widgets")`) is served from the root all the same. Read one
# decoration at a time, the prefix registered the CLASS, which no closure walks, and a relative path registered
# nothing, so a test driving such a handler over HTTP reached nothing: a request test for a class-mapped controller
# counted 0 tests. A decoration is a mapping when its NAME says so (…Mapping, JAX-RS @Path, a verb, ASP.NET's
# [Route] / [HttpGet]); a `@Transactional` beside it is not a route. ASP.NET's [controller] and [action] tokens are
# the type's name without its Controller suffix and the method's name.
import collections, re
_MAPPING = re.compile(r'^(\w*Mapping|Path|GET|POST|PUT|DELETE|PATCH|Http(Get|Post|Put|Delete|Patch)|Route)$')


def _first_path(text):
    m = re.search(r'"([^"\s]{0,120})"', (text or '').replace('"""', '"'))
    return m.group(1) if m else None


def _join(a, b):
    return '/' + '/'.join(x.strip('/') for x in (a, b) if x and x.strip('/'))


def _prefixed_routes(q, rows, sf):
    if not _has(q, 'symbols'):
        return []
    seen = {(r[0], r[4]) for r in rows}
    sym = {i: (d, n, o, bool(t) and not m) for i, d, n, o, t, m in q("SELECT id, display, name, owner, type_id, method_id FROM symbols WHERE display IS NOT NULL")}
    prefix = collections.defaultdict(set)                      # type display -> the paths its own mapping serves
    methods = []
    for owner, name, text, f, l in q("SELECT owner_id, name, text, file, line FROM decorations WHERE owner_id IS NOT NULL"):
        short = (name or '').split('.')[-1]
        if not _MAPPING.match(short) or owner not in sym: continue
        p_ = _first_path(text)
        d, n, o, is_type = sym[owner]
        if is_type:
            if p_: prefix[d].add(p_)
        else:
            methods.append((owner, short, p_, f, l))
    out = []
    for mid, short, p_, f, l in methods:
        d, n, o, _t = sym[mid]
        tname = (o or '').split('.')[-1]
        for pre in sorted(prefix.get(o) or {''}):
            key = _join(pre, p_ or '')
            key = key.replace('[controller]', re.sub(r'Controller$', '', tname).lower()).replace('[action]', (n or '').lower())
            if key == '/' and not (pre or p_): continue
            if (mid, key) in seen: continue
            seen.add((mid, key))
            out.append((mid, sf(f) if f else '', l or 0, 'route', key,
                        f'registered as a route "{key}" by @{short}' + (" under its type's prefix" if pre else '') + ' — the router calls it, no call site does'))
    return out


# THE HTTP METHOD A ROUTE ANSWERS, AND THE ONE A TEST SENDS. "/orders" is two handlers when one answers GET and the other
# POST, and a test that posts an order drives only the second. Joined on the path alone, every test that lists orders
# reached the handler that creates one, and a path five tests write (one per verb) was refused as a key that
# identifies nothing. The verb is read where it is written: the handler's decoration (`@GetMapping`, `[HttpPost]`,
# `@router.put`, `@RequestMapping(method = DELETE)`, JAX-RS `@DELETE` beside `@Path`) and the request call that
# carries the path literal (`.put("/orders/{id}", id)`, `client.delete(...)`, `DeleteAsync(...)`). Either side unknown
# joins as before.
_VERBS = ('GET', 'POST', 'PUT', 'DELETE', 'PATCH')
_VERB_NAME = re.compile(r'^(?:(Get|Post|Put|Delete|Patch)Mapping|Http(Get|Post|Put|Delete|Patch)|(GET|POST|PUT|DELETE|PATCH)|(get|post|put|delete|patch))$')


def route_verbs(q, site_file=None):
    """{(decl, key, VERB)}: the HTTP method each decoration-registered route answers, where a decoration says it."""
    if not _has(q, 'decorations'):
        return set()
    verbs = collections.defaultdict(set)
    for owner, name, text in q("SELECT owner_id, name, text FROM decorations WHERE owner_id IS NOT NULL"):
        short = (name or '').split('.')[-1]
        m = _VERB_NAME.match(short)
        if m:
            verbs[owner].add(next(g for g in m.groups() if g).upper())
        elif _MAPPING.match(short) or short == 'route':
            for v in re.findall(r'\b(GET|POST|PUT|DELETE|PATCH)\b', text or ''): verbs[owner].add(v)
    out = set()
    for decl, _f, _l, kind, key, _w in decoration_keys(q, site_file):
        if kind == 'route':
            for v in verbs.get(decl, ()): out.add((decl, key, v))
    return out


def literal_verbs(q, at, site_file=None):
    """{(caller, literal, VERB)}: a path literal written as the argument of a request call named for one HTTP method —
    the innermost such call whose span holds the literal's line."""
    if not (_has(q, 'literals') and _has(q, 'call_sites')):
        return set()
    sf = site_file or (lambda x: x)
    calls = collections.defaultdict(list)
    for n, f, a, b in q("SELECT callee_name, file_path, start_line, end_line FROM call_sites WHERE callee_name IS NOT NULL AND start_line > 0"):
        short = re.sub(r'Async$', '', (n or '').split('.')[-1].split('<')[0]).upper()
        if short in _VERBS: calls[sf(f) if f else ''].append((a, b or a, short))
    out = set()
    for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
        if not (isinstance(v, str) and v.startswith('/')): continue
        f2 = sf(f) if f else ''
        hold = [(b - a, -a, verb) for a, b, verb in calls.get(f2, ()) if a <= l <= b]
        if not hold: continue
        verb = min(hold)[2]
        c = at(f, l)
        if c: out.add((c, v, verb))
    return out


# ── a registration written as a CALL that no verb list knows ─────────────────────────────────────────────────
# the Python web framework's `application.add_url_rule("/quote/<order_id>", view_func=legacy_quote)` is a route registration whose verb
# is not an HTTP verb, and the same shape appears wherever a framework takes (path, handler) under a name of its own
# choosing. The evidence is the pair, not the name: one line carrying a PATH-SHAPED literal and a declaration named
# as a VALUE. That is the discriminator `registrations()` already trusts for the verb list, applied without it.
#
# Kept apart from `registrations()` on purpose: that function's rows were measured on a TypeScript application and
# this leg would change them, so a caller opts in rather than inherits it.
def value_route_registrations(q, site_file=None):
    """[(decl, file, line, 'route', key, why)] — a path literal and a handed-over declaration on one line."""
    if not (_has(q, 'call_sites') and _has(q, 'literals') and _has(q, 'refs')):
        return []
    sf = site_file or (lambda x: x)
    once = {}
    for n, i, c in q("""SELECT name, min(id), count(*) FROM symbols WHERE method_id IS NOT NULL AND name IS NOT NULL
                        AND name NOT LIKE '<%' GROUP BY name"""):
        if c == 1:
            once[n] = i
    ek = ','.join('?' * len(CALLABLE_EK))
    ref_at = {}
    for n, f, l in q(f"SELECT name, file, line FROM refs WHERE line > 0 AND entity_kind IN ({ek})", *CALLABLE_EK):
        if n in once:
            ref_at.setdefault((f, l), once[n])
    routed = _routed_views(q)
    served = _served_paths(q)
    names_at = {}
    if routed:
        for n, f, l in q("SELECT name, file, line FROM refs WHERE line > 0 AND name IS NOT NULL"):
            if (f, n) in routed:
                names_at.setdefault((f, l), set()).update(routed[(f, n)])
    import re
    out = []
    for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
        if not (isinstance(v, str) and 0 < len(v) < 160):
            continue
        # A RESOURCE IS NOT A ROUTE. Measured on the JVM parser: the pair fired on
        # `connect(url).onResponseProgress(progressListener)` — a path-shaped literal and a handed-over callable on
        # one line, but the path is the file being fetched, not the key the listener is registered under. That put
        # 27 by-key edges into the closure from every test that mentions `/htmltests/large.html`. A registered route
        # names a resource by STRUCTURE; a fetched file ends in an extension and may carry a query, so both are out.
        last = v.split('?')[0].split('#')[0].rstrip('/').rsplit('/', 1)[-1]
        if '?' in v or re.search(r'\.[A-Za-z0-9]{1,6}$', last):
            continue
        # the views the engine's own url_dispatch rule says a route on this line dispatches to (#1483): a view named as
        # a module attribute (`views.order_list`) is a reference the parser gives no callable entity kind, and a
        # class-based view is named by its class, not by the handler the framework calls
        routed_here = names_at.get((f, l), ())
        if v.startswith('/'):
            ds, key = ({ref_at[(f, l)]} if (f, l) in ref_at else set()) | set(routed_here), v
        # A ROUTE TABLE WRITES ITS PATTERN WITHOUT THE LEADING SLASH (#1482): `path("orders/<int:pk>/", view)`
        # serves `/orders/5/`. Such a string is not path-shaped on its own, since `name="order-list"` sits on the
        # same line, so it is read only where the engine has already said the line routes to a view, only when it
        # has a segment separator, and never as a regular expression. A view whose served path the engine wrote on
        # the edge is keyed by that path below, prefix and all; this is the fallback for one it could not compose.
        elif routed_here and '/' in v and not re.search(r'[\s^$\\]', v):
            ds, key = set(routed_here) - set(served), '/' + v
        else:
            continue
        for d in ds:
            out.append((d, sf(f) if f else '', l or 0, 'route', key,
                        f'registered at "{key}" here — the framework calls it, no call site does'))
    # THE PATH THE ROUTE SERVES, AS THE ENGINE COMPOSED IT (#1511): `path("status/", views.api_status)` in a table that
    # `path("api/v1/", include(api_patterns))` mounts is served at `/api/v1/status/`, which no single line spells. The
    # registration sits on the line that names the view. A bare `/` is not a key: a table the engine could not see
    # mounted (`include("app.urls")`) is served under a prefix it does not know, and its empty pattern would join
    # every request for the site root.
    for d, keys in served.items():
        at = sorted(fl for fl, ds in names_at.items() if d in ds)
        if not at:
            continue
        f, l = at[0]
        for key in keys:
            if key != '/':
                out.append((d, sf(f) if f else '', l or 0, 'route', key,
                            f'registered at "{key}" here — the framework calls it, no call site does'))
    return sorted(set(out))


def _served_paths(q):
    """{declaration: {path}} — the paths the engine's url_dispatch edges say each view is served at."""
    if not all(_has(q, t) for t in ('ext_framework_edge', 'symbols')):
        return {}
    out = {}
    for d, p in q("""SELECT s.id, e.c3 FROM ext_framework_edge e JOIN symbols s ON s.method_id = e.c1
                     WHERE e.c2 = 'url_dispatch' AND e.c3 LIKE '/%'"""):
        out.setdefault(d, set()).add(p)
    return out


def _routed_views(q):
    """{(route_file, name): {declaration}} — the views the engine dispatches a route table in route_file to.

    Keyed by every name a route entry spells the view with: a function view by its own name, a class-based view's
    handler by its class or any subclass (`WidgetView.as_view()` dispatches to a `get` WidgetView inherits). A name
    that means two different views from one route file identifies neither and is dropped.
    """
    if not all(_has(q, t) for t in ('ext_framework_edge', 'methods', 'symbols')):
        return {}
    rows = q("""SELECT fm.file_path, s.id, t.name, t.owner_type_id FROM ext_framework_edge e
                JOIN methods fm ON fm.id = e.c0 JOIN methods t ON t.id = e.c1 JOIN symbols s ON s.method_id = e.c1
                WHERE e.c2 = 'url_dispatch'""")
    if not rows:
        return {}
    tname = {i: n for i, n in q("SELECT id, name FROM types")} if _has(q, 'types') else {}
    subs = {}
    if _has(q, 'type_ancestors'):
        for t, a in q("SELECT type_id, ancestor_type_id FROM type_ancestors"):
            subs.setdefault(a, set()).add(t)
    by = {}                                              # (file, name) -> {(view identity, declaration)}
    for f, d, n, owner in rows:
        if owner:
            for t in {owner} | subs.get(owner, set()):
                if t in tname:
                    by.setdefault((f, tname[t]), set()).add((t, d))
        else:
            by.setdefault((f, n), set()).add((d, d))
    return {k: {d for _i, d in v} for k, v in by.items() if len({i for i, _d in v}) == 1}


# ── the two spellings of one path ────────────────────────────────────────────────────────────────────────────
# A test asks for `/orders/o-1/price`; the handler is registered at `/orders/{order_id}/price`. Neither string
# contains the other and no call site joins them — the router does, at run time, by matching the path. A path
# parameter is whatever the framework spells it (`{id}` FastAPI, `<int:id>` a Python web framework, `:id` Express, `*` a wildcard),
# so a registered segment in any of those forms matches any written segment and NEITHER side is normalised.
_PATH_PARAM = None


def route_matches(written, registered):
    """True when a URL written at a call site is the route registered under `registered`."""
    global _PATH_PARAM
    if _PATH_PARAM is None:
        import re as _re
        _PATH_PARAM = _re.compile(r'\{.*\}|<.*>|:.+|\*.*')
    if not (written.startswith('/') and registered.startswith('/')):
        return False
    segs = lambda p: p.split('?')[0].split('#')[0].rstrip('/').split('/')
    w, r = segs(written), segs(registered)
    return len(w) == len(r) and all(_segment_matches(a, b) for a, b in zip(w, r))


def _segment_matches(written, registered):
    """One segment: equal, or a parameter that accepts what is written there.

    A TYPED CONVERTER NARROWS WHAT IT ACCEPTS. `<int:pk>` serves `/orders/5/` and never `/orders/new/`: the router
    tries the next pattern instead, so a test requesting `/orders/new/` does not reach the detail view. A written
    segment that is itself a placeholder (`{}`, `%s`, `<pk>`) could be any value and still matches.
    """
    if written == registered:
        return True
    if not _PATH_PARAM.fullmatch(registered):
        return False
    if registered.startswith('<int:'):
        return written.isdigit() or bool(_PATH_PARAM.fullmatch(written)) or '%' in written
    return True


def route_candidates(written, registered_keys):
    """The registered keys a written URL can be served by. A key registered VERBATIM wins over every pattern with a
    parameter: `/orders/settings/` is its own route even beside `/orders/<slug>/`, the way a router serves the
    literal route rather than capturing `settings` as a value."""
    if written in registered_keys:
        return [written]
    return [k for k in registered_keys if route_matches(written, k)]


def all_registrations(q, site_file=None):
    """Every (decl, file, line, kind, key, why) this module can derive, from all three sources."""
    return sorted(set(registrations(q, site_file) + decoration_keys(q, site_file) + value_route_registrations(q, site_file)))


# ── the same join the rules make, for a caller that has no Datalog ───────────────────────────────────────────
# dl/impact.dl derives `fw_edge` from `literal`, `reg_key` and the two caps. A caller without a solver — the SQL
# port, or anything deciding whether the rules would find something it cannot — needs the same answer, so the join
# lives here once rather than twice. The caps are the rules' defaults and the same environment variables override
# them, because a difference between the two engines that comes from a default is the hardest kind to notice.
def key_edges(q, at, site_file=None, cap=None, use_cap=None):
    """[(caller, registered_declaration, key)] — a callable writes a key, and that key registers a declaration.

    `at(file, line) -> callable id` is the caller's own line map; nothing here can build it. A key that more than
    `cap` declarations register, or that more than `use_cap` callables write, identifies nothing and is refused —
    one Python web framework's own suite registers "/" from 236 places and the JVM parser's surviving keys are HTML tag names.
    """
    import collections, os
    cap = int(os.environ.get('AXIOMCODE_KEY_CAP', '4')) if cap is None else cap
    use_cap = int(os.environ.get('AXIOMCODE_KEY_USE_CAP', '4')) if use_cap is None else use_cap
    if not _has(q, 'literals'):
        return []
    reg = collections.defaultdict(set)
    for decl, _f, _l, _kind, key, _why in all_registrations(q, site_file):
        if decl and key: reg[key].add(decl)
    if not reg:
        return []
    writes = collections.defaultdict(set)
    for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
        if not isinstance(v, str) or len(v) > 160: continue
        c = at(f, l)
        if c: writes[v].add(c)
    capped = {k for k, ds in reg.items() if len(ds) > cap} | {k for k, cs in writes.items() if len(cs) > use_cap}
    out = set()
    for v, callers in writes.items():
        for key in route_candidates(v, reg):
            if key in capped: continue
            for c in callers:
                for d in reg[key]:
                    if c != d: out.add((c, d, key))
    return sorted(out)
