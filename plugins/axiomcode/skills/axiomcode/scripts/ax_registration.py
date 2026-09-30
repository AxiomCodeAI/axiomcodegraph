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
import collections
import re
import os

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
                    handlers = _Handlers(q, read, sf)
                hands = _any3(_hands_over(t, handlers, f, read(f)) for s, t, _l in args if not s) \
                    if short.lower() in HTTP_VERB else True
                if hands is False or (hands is None and _used_as_promise(read(f), a, _ac, b, col)):
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
        # prefixed `path + '/:id'` a resource helper composes — never one inside a nested call's own arguments. A route
        # written as one options object (`fastify.route({ method: 'DELETE', url: '/items/:id', handler })`) holds its
        # path as a property value of that object, one bracket in
        path, at, d = None, lo + len(text[lo:hi]) - len(text[lo:hi].lstrip()), 0
        obj = t.startswith('{')
        for k in range(lo, hi):
            c = blank[k]
            if c in _OPEN: d += 1
            elif c in _CLOSE: d -= 1
            elif c in '\'"`' and (d == 0 or (obj and d == 1 and blank[:k].rstrip().endswith(':'))):
                # a template may put a base URL first: `${env.API_URL}/auth/register` registers `/auth/register`
                m = re.match(r'([\'"`])(/[^\'"`\n]*)\1|`(?:\$\{[^}`]*\})+(/[^`\n]*)`', text[k:hi])
                if m: path, at = m.group(2) or m.group(3), k
                if m or d == 0: break
        out.append((path, t, a + text.count('\n', 0, at)))
    return out


_NOT_CALLABLE = {'field', 'const', 'var', 'variable', 'param', 'parameter', 'typeparam', 'module', 'type', 'enum',
                 'enum_member', 'property', 'local'}


class _Handlers:
    """What a route call's argument is checked against: `names` (name -> {kind: {file}} of every declaration), the
    names of callables the engine says return a function, and — read once per const, from its initializer — whether a
    const holds a function (`const h = catchAsync(…)`) or data (`const opts = { headers: {} }`)."""

    def __init__(self, q, read, sf):
        self.q, self.read, self.sf, self.names, self.consts, self.held = q, read, sf, {}, {}, {}
        if _has(q, 'symbols'):
            for n, k, f, l in q("SELECT name, kind, file, line FROM symbols WHERE name IS NOT NULL"):
                self.names.setdefault(n, {}).setdefault(k or '', set()).add(f)
                if k == 'const' and l: self.consts.setdefault(n, set()).add((f, l))
        self.returns_fn = set()
        if _has(q, 'symbols'):
            for w, _m in returned_functions(q):
                self.returns_fn.update(n for (n,) in q("SELECT name FROM symbols WHERE method_id = ? AND name IS NOT NULL", w))

    def holds_fn(self, n, files=None):
        """a const `n` (declared in one of `files`, or anywhere) holds a function; kept when no declaration of it can be
        read, as before its initializer was looked at"""
        decls = sorted((f, l) for f, l in self.consts.get(n, ()) if files is None or f in files)
        readable = [(f, l, n) for f, l in decls if self.read(f)]
        if not readable:
            return True
        key = tuple(readable)
        if key not in self.held:
            # a module a const requires may export the handler itself: `const h = require('./h'); app.get('/x', h)`
            required = any(re.search(rf'(?<![\w$.]){re.escape(n)}\s*=\s*require\s*\(', (self.read(f) or [''])[l - 1])
                           for f, l, _n in readable if 0 < l <= len(self.read(f)))
            fns, _w, _a = const_values(self.q, self.read, readable, self.sf)
            self.held[key] = required or bool(fns)
        return self.held[key]


def _names_handler(t, h, f, L):
    """a written name `h` or `a.b.h` is a handler: `h` a function or method; a member of a module this file imports
    (`users.signup`, `exports.signup = …` declares nothing); `this.h` a property of the class; or a const holding a
    function (a wrapped handler, `const h = catchAsync(…)`) this file declares or imports. The same name as a parameter,
    a local, a field of a type, some other module's `data` (`api.post('/discussions', data)`) or a const holding data
    (`const opts = { headers: {} }`, `cfg.options`) is the request's data."""
    parts = re.split(r'\s*\??\.\s*', t)
    kinds = h.names.get(parts[-1], {})
    if any(k not in _NOT_CALLABLE for k in kinds):
        return True
    here = parts[0]
    # a call site's file is relative to the indexed source root and a declaration's to the repository (`--src src`:
    # `requests.js` and `src/requests.js`), so "this file" is the declaration's file ending in the site's
    mine = lambda fs: {x for x in fs if f and (x == f or x.endswith('/' + f))}
    if len(parts) > 1 and here == 'this':
        return any(mine(fs) for k, fs in kinds.items() if k in ('const', 'field', 'property'))
    n = re.escape(here)
    imported = bool(re.search(r'\bimport\b[^;]*?\b%s\b[^;]*?\bfrom\b|\b%s\b[^=;\n]*=\s*require\s*\(' % (n, n),
                              '\n'.join(L or ())))
    if len(parts) > 1:
        return imported and ('const' not in kinds or h.holds_fn(parts[-1]))
    if mine(kinds.get('const', ())):
        return h.holds_fn(parts[-1], mine(kinds['const']))
    return imported and 'const' in kinds and h.holds_fn(parts[-1])


def _any3(vs):
    """True if one is, else None if one is unknown, else False"""
    vs = list(vs)
    return True if True in vs else (None if None in vs else False)


def _hands_over(t, h, f=None, L=None):
    """True when the argument text can be something a router calls: a function, a name declared as a handler, a call
    that makes one (a wrapper handed a function or handler, a callable the engine says returns a function), an array of
    those. False for the request's data: a string, a number, an object, `new X()`, an `await`, a name that is not a
    handler (a parameter, a local, a const holding data), or a call of this repository's own callable handed only data
    (`buildConfig()`: the engine read its body and saw no function returned). None for a library call handed only data:
    `JSON.stringify(x)` and `swaggerUi.setup(specs)` read alike, and the call's own use tells them apart."""
    t = t.strip()
    if not t or t[0] in '\'"`{' or t[0].isdigit() or re.match(r'(new|await|true|false|null|undefined)\b', t):
        return False
    if t.startswith('...') or _fn_literal(t):
        return True
    if t.startswith('[') and t.endswith(']'):
        b = _blank(t)
        return _any3(_hands_over(t[lo:hi], h, f, L) for lo, hi in _split_args(b, 1, len(b) - 1))
    if _CHAIN.fullmatch(t):
        return _names_handler(t, h, f, L)
    m = re.match(rf'({_IDENT}(?:\s*\??\.\s*{_IDENT})*)\s*\(', t)
    if m:
        # a call: `wrap(async (req, res) => …)`, `asyncHandler(listItems)`, curried `wrap(opts)(fn)` or a factory the
        # engine says returns a function hands one over
        callee = re.split(r'\s*\??\.\s*', m.group(1))[-1]
        if callee in h.returns_fn:
            return True
        b, k = _blank(t), m.end() - 1
        while k < len(t) and b[k] == '(':
            e = _match(b, k)
            if _any3(_hands_over(t[lo:hi], h, f, L) for lo, hi in _split_args(b, k + 1, e - 1)):
                return True
            k = e
            while k < len(t) and t[k] in ' \t': k += 1
        # only a bare `f(…)` is this repository's own by its name: `swaggerUi.setup(specs)` is the library's `setup`,
        # whatever else of that name the repository declares
        own = '.' not in m.group(1) and any(k_ not in _NOT_CALLABLE for k_ in h.names.get(callee, {}))
        return False if own else None
    return True                           # a conditional, an expression not read further: kept


def _used_as_promise(L, a, ac, b, bc):
    """the call's result is awaited or chained with `.then` / `.catch` / `.finally`: a request's promise — a router's
    registration returns the router, never awaited or thenned"""
    if not L or not ac or not bc or b > len(L) or a < 1:
        return False
    if re.search(r'\bawait\s*$', L[a - 1][:ac - 1]):
        return True
    rest = '\n'.join([L[b - 1][bc - 1:]] + L[b:b + 2])
    return bool(re.match(r'\s*\??\.\s*(then|catch|finally)\s*\(', rest))


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
# NOT EVERY QUOTED STRING IN A DECORATION IS WHAT IT REGISTERS THE DECLARATION UNDER (#1413). Three shapes carry a
# string that no caller will ever write to reach the declaration, and each was printed as "registered under" and then
# followed: a method that merely returned the same word was listed as reaching the change.
#   1. a decoration that names a WARNING or a status, and registers nothing: `@SuppressWarnings("unchecked")`,
#      `[SuppressMessage(...)]`, `@Deprecated(since = "2")`, `[Obsolete("...")]`, `@Generated("tool")`. A language-level
#      table (the compilers' own annotations and the analysers' suppressions), not a framework list.
_NOT_A_REGISTRAR = re.compile(r'^(Suppress\w*|Deprecated|Obsolete|Generated|SafeVarargs|FunctionalInterface)$')
#   2. a KEYWORD argument that configures the registration rather than naming it: `mode="before"`, `methods=["GET"]`,
#      `tags=["orders"]`, `method = "byShelf"`. A positional string is the key (`@router.post("/orders")`,
#      `@receiver("order_created")`); a keyword one is only when the keyword says it names the thing registered.
_KEY_KEYWORD = re.compile(r'^(value|values|path|paths|name|names|topics?|topic_?pattern|queues?|destinations?|channels?|'
                          r'subjects?|commands?|events?|signals?|routes?|patterns?|urls?|uri|endpoint|keys?|routing_?key|'
                          r'binding_?key|alias(es)?|rule|address|mapping)$', re.I)
#   3. a string that names a MEMBER OF A TYPE THE SAME DECORATION NAMES: `@SelectProvider(type = StockSql.class,
#      method = "byShelf")` points at StockSql.byShelf; it is a reference to that method, not a key for this one.
#      Only decided with the graph (`names_member(type, name)`); without it the string is kept.
_STRING = re.compile(r'"([^"]{1,120})"|\'([^\']{1,120})\'')
_KEYWORD_BEFORE = re.compile(r'(\w+)\s*[=:]\s*[\[{(]?\s*(?:(?:"[^"]*"|\'[^\']*\')\s*,\s*)*$')
_TYPE_ARG = re.compile(r'(?<![\w."\'$])([A-Z][\w$]*)(?:\s*\.\s*class)?(?=\s*[,)\]}])')


def decoration_key_strings(text, name=None, names_member=None):
    """the strings a decoration's text registers its declaration under, sorted: every quoted string in it but prose,
    and but the three shapes above (a non-registering decoration `name`, a configuring keyword, a member reference).
    A STRING WITH A SPACE IN IT IS PROSE, NOT A KEY: `@widgets.doc("Endpoint to list the widgets")`, `@Operation(summary = "List
    the orders")`, a cron expression, a query. No route, command, signal or table name is written with one, and read as
    a key the description was printed as what the framework dispatches on."""
    if name and _NOT_A_REGISTRAR.match(name.split('.')[-1].lstrip('@[')):
        return []
    t = text or ''
    types = _TYPE_ARG.findall(_STRING.sub('""', t)) if names_member else []
    out = set()
    for m in _STRING.finditer(t):
        key = m.group(1) or m.group(2)
        if not key or re.search(r'\s', key): continue
        kw = _KEYWORD_BEFORE.search(t[:m.start()].replace('"""', '"'))
        if kw and not _KEY_KEYWORD.match(kw.group(1)): continue
        if any(names_member(ty, key) for ty in types): continue
        out.add(key)
    return sorted(out)


def member_names(q):
    """names_member for decoration_key_strings, read from the graph: does a type of this simple name declare a member
    of that name"""
    pairs = set()
    if _has(q, 'symbols'):
        for owner, n in q("SELECT owner, name FROM symbols WHERE owner IS NOT NULL AND method_id IS NOT NULL"):
            if owner and n: pairs.add((owner.split('.')[-1], n))
    return lambda ty, key: (ty.split('.')[-1], key) in pairs


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
    members = member_names(q)
    out = []
    for owner, name, text, f, l in q("""SELECT owner_id, name, text, file, line FROM decorations
                                        WHERE text IS NOT NULL AND text <> '' AND owner_id IS NOT NULL"""):
        if owner in tests:
            continue
        short = (name or '').split('.')[-1]
        for key in decoration_key_strings(text, name, members):
            kind = 'route' if key.startswith('/') else 'key'
            why = (f'registered as a route "{key}" by @{short} — the router calls it, no call site does' if kind == 'route'
                   else f'registered under "{key}" by @{short} — whoever writes that string reaches it, and no call site does')
            out.append((owner, sf(f) if f else '', l or 0, kind, key, why))
    suffix = set()
    out += _prefixed_routes(q, out, sf, suffix)
    # A JAVA HANDLER UNDER A TYPE PREFIX IS NOT SERVED AT ITS OWN PATH ALONE. `@RequestMapping("/auth")` on the class and
    # `@PostMapping("/login")` on the method serve "/auth/login" and nothing else, but the method's decoration was also
    # read as a route "/login" on its own, so any "/login" written anywhere (a security rule, a string array in a
    # test) reached it, and a bare template such as "/{ids}" matched every one-segment path in the repository. Where
    # the type's prefix is known, only the composed route is kept.
    if suffix:
        out = [r for r in out if not (r[3] == 'route' and (r[0], r[4]) in suffix)]
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


def _prefixed_routes(q, rows, sf, suffix=None):
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
            # a Java mapping may serve several paths (`@GetMapping(value = {"/", "/{id}"})`): each is composed
            ps = [p_]
            if (f or '').endswith('.java'):
                ps = re.findall(r'"(/[^"\s]{0,120})"', text or '') or [p_]
            for x in dict.fromkeys(ps): methods.append((owner, short, x, f, l))
    out = []
    for mid, short, p_, f, l in methods:
        d, n, o, _t = sym[mid]
        tname = (o or '').split('.')[-1]
        pres = prefix.get(o) or {''}
        if suffix is not None and p_ and (f or '').endswith('.java') and any(x.strip('/') for x in pres):
            own = {_join(pre, p_) for pre in pres}
            for raw in {p_, '/' + p_.lstrip('/')}:
                if raw not in own: suffix.add((mid, raw))
        for pre in sorted(pres):
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


# A JAVA PATH LITERAL THAT IS NOT A REQUEST IS NOT A ROUTE KEY. `.requestMatchers("/login").permitAll()`,
# `registry.addInterceptor(i).addPathPatterns("/**")`, `properties.setExcludes(new String[]{"/login"})` and
# `StringUtils.isMatch("/system/**", path)` write paths, but none of them sends a request, so none of them reaches the
# handler registered at that path: joined by key, one security config pulled 59 callables and 17 string-holding tests
# into the impact of a service behind one controller. A literal is refused as a key when it is a pattern (holds `*`,
# which no request path does) or when no innermost call written around it on its line is a request call (an
# HTTP verb, MockMvc's perform / multipart, a RestTemplate or WebClient method, a URI or URL). A literal
# written outside any call (a constant, a local later handed to a request) is kept, since its use is not visible here,
# except the bare root "/", which such code writes for every other reason.
_REQUEST_CALL = re.compile(r'^(get|post|put|delete|patch|head|options|perform|multipart|exchange|uri|url|'
                           r'\w+ForObject|\w+ForEntity|postForLocation|headForHeaders|optionsForAllow|URI|URL|'
                           r'HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|fromPath|fromUriString|'
                           r'sendRedirect|getRequestDispatcher)$')


def route_literal_refused(q, at, site_file=None):
    """{(caller, literal, file, line)}: a Java path literal that is not the argument of a request call, so it must
    not key-match a route (file and line as the literals table writes them)."""
    if not (_has(q, 'literals') and _has(q, 'call_sites')):
        return set()
    sf = site_file or (lambda x: x)
    calls = collections.defaultdict(list)
    for n, f, a, b in q("SELECT callee_name, file_path, start_line, end_line FROM call_sites "
                        "WHERE callee_name IS NOT NULL AND start_line > 0 AND file_path LIKE '%.java'"):
        short = re.sub(r'Async$', '', (n or '').split('.')[-1].split('<')[0])
        calls[sf(f) if f else ''].append((a, b or a, short))
    # the call table may spell a file absolutely and the literal table relatively: matched on the trailing path too
    by_base = collections.defaultdict(list)
    for cf in calls: by_base[os.path.basename(cf)].append(cf)
    def calls_in(f):
        k = sf(f) if f else ''
        if k in calls: return calls[k]
        return next((calls[cf] for cf in by_base.get(os.path.basename(f or ''), ()) if cf.endswith('/' + (f or '').lstrip('/'))), ())
    out = set()
    for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value GLOB '/*' AND file LIKE '%.java'"):
        if not isinstance(v, str): continue
        hold = [(b - a, -a, n) for a, b, n in calls_in(f) if a <= l <= b]
        if '*' in v: refused = True
        elif not hold: refused = v == '/'                                 # the bare root is a request only when one sends it
        else:
            # the calls on a line carry no column, so every innermost one is a candidate: a fluent request
            # (`given().body(b).when().post("/orders")`) is a request when any of its tied innermost calls is one
            w = min(h[0] for h in hold)
            refused = not any(_REQUEST_CALL.match(n) for d, _a, n in hold if d == w)
        if refused:
            c = at(f, l)
            if c: out.add((c, v, f, l))
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
    """Every (decl, file, line, kind, key, why) this module can derive, from all four sources."""
    return sorted(set(registrations(q, site_file) + decoration_keys(q, site_file) + value_route_registrations(q, site_file)
                      + table_registrations(q, site_file)))


# ── a HANDLER TABLE: a declaration registered under the KEY of the entry that holds it ──────────────────────────
# One service publishes an event by its type (`bus.publish(TOPICS.CREATED, doc)`, `emit("doc.created", …)`); another
# holds a table of handlers keyed by the same string (`{ [TOPICS.CREATED]: onCreated }`, `{ 'doc.created'(env) {…} }`,
# `{"doc.created": on_created}`) and a consumer looks the handler up by the message's type (`handlers[type](env)`).
# The graph has both ends and the lookup is a computed member, so nothing joined the publisher to the handler: impact
# of the producing method missed every consumer, and the tests that publish the type never reached the handler.
# It is a registration like a route: the entry's key is what the dispatcher dispatches on. Two facts are read here:
#   the table entry   a callable DECLARED on the entry's own line, right after its key (`[K]: function …`, `[K]: (e) =>`,
#                     `'k'(e) {`, `"k": lambda e: …`), or a callable NAMED as the entry's whole value (`[K]: onCreated,`).
#                     A key is a string literal or a constant reference resolved to one; an entry whose value is an
#                     array, a call's result or a schema is data, not a handler, and registers nothing.
#   the constant      `TOPICS.CREATED` is the string its declaration gives it (`export const TOPICS = { CREATED:
#                     'doc.created' }`, `class Topics: CREATED = "doc.created"`, `static final String CREATED = …`),
#                     kept only when every declaration of that name agrees. A key written through a constant is a
#                     write of the string; the constant's own declaration and another table's key position are not.
_IDENT = r'[A-Za-z_$][\w$]*'
_CONST_REF = rf'{_IDENT}(?:\.{_IDENT})+'
_KEY_STR = r"""(?P<qt>['"])([^'"\\\s]{1,120})(?P=qt)"""     # named: its group number differs in each pattern
# the start of a function value: `function`, `async (e) =>`, `e =>`, `(e) =>`, a Python `lambda`
_FN_START = rf'(?:async\s+)?(?:function\b|lambda\b|\(|{_IDENT}\s*=>)'
# the key of an entry that DECLARES its handler on this line: `[K]: <fn>`, `[K](…) {`, `'k': <fn>`, `'k'(…) {`, and a
# Python dict's `Topics.K: lambda …`. Method shorthand may carry `async` / `static` / `*`.
_ENTRY_DECL = re.compile(rf"""^\s*(?:(?:async|static|get|set)\s+|\*\s*)*(?:(?:\[\s*({_CONST_REF}|{_IDENT})\s*\]|{_KEY_STR})\s*(?::\s*{_FN_START}|\()|({_CONST_REF})\s*:\s*{_FN_START})""")
# an entry whose WHOLE value names a handler: `[K]: onCreated,` / `'k': handlers.onCreated,` / `"k": on_created,`
_ENTRY_REF = re.compile(rf"""^\s*(?:\[\s*({_CONST_REF}|{_IDENT})\s*\]|{_KEY_STR}|({_CONST_REF}))\s*:\s*(?:this\.|self\.)?({_IDENT}(?:\.{_IDENT})*)\s*,?\s*(?:\}}\s*[,;)]*\s*)?$""")
# a string constant: an object literal's `K: 'v'` (one per line or several on one), and a declaration `K = 'v'`
_CONST_ENTRY = re.compile(rf"""(?:^|[{{,])\s*({_IDENT})\s*:\s*{_KEY_STR}\s*(?=,|\}}|$)""")
_CONST_DECL = re.compile(rf"""(?:^|\s)({_IDENT})\s*(?::\s*[\w.<>\[\]]+\s*)?=\s*{_KEY_STR}\s*[;,]?\s*$""")
# a key POSITION, not a write: the quoted key or the constant is followed by `:` (an entry, a `case`), `(` (a method
# shorthand) or `]` and then `:` / `(` / `=` (a computed key, a C# index initializer)
_KEY_POS = re.compile(r'\s*(?::(?!:)|\(|\]\s*[:(=])')


def string_constants(q, read=None):
    """({'TOPICS.CREATED': 'doc.created', 'CREATED_TYPE': 'doc.created', …}, {(file, line)}): the string each constant
    name denotes, where every declaration of the name agrees, and the lines that declare them (a literal there is the
    constant's definition, not a write of its value)."""
    if not _has(q, 'symbols'):
        return {}, set()
    read = read or _source_reader(q)
    seen = collections.defaultdict(set)
    pos = set()
    types = {i: n for i, n in q("SELECT id, name FROM symbols WHERE id IS NOT NULL AND method_id IS NULL AND type_id IS NOT NULL")}
    for n, f, a, b, owner, kind in q("""SELECT name, file, line, end_line, owner, kind FROM symbols
                                        WHERE method_id IS NULL AND name IS NOT NULL AND file IS NOT NULL AND line > 0
                                          AND kind NOT IN ('class', 'interface', 'enum', 'record', 'struct', 'module', 'type', 'namespace')"""):
        L = read(f)
        if not L or not re.fullmatch(_IDENT, n): continue
        b = max(a, min(b or a, a + 400, len(L)))
        oname = (types.get(owner) or (owner or '').split('.')[-1]) if owner else ''
        m = _CONST_DECL.search(L[a - 1]) if a <= len(L) else None
        if m and m.group(1) == n and b == a:
            seen[f'{oname}.{n}' if oname else n].add(m.group(3)); pos.add((f, a))
            continue
        for ln in range(a, b + 1):
            for k, _qt, v in _CONST_ENTRY.findall(L[ln - 1]):
                seen[f'{n}.{k}'].add(v); pos.add((f, ln))
    return {k: next(iter(vs)) for k, vs in seen.items() if len(vs) == 1}, pos


def _entry_key(m, consts):
    """the string a matched entry is keyed by: its literal, or the constant it names resolved; None when unknown"""
    ref, lit, cref = m.group(1), m.group(3), m.group(4)
    if lit: return lit
    return consts.get(ref or cref)


def table_registrations(q, site_file=None, consts=None):
    """[(decl, file, line, 'table', key, why)] — a callable registered in a handler table under the entry's key.
    An entry in a test file is a fixture's table, and is not what the application dispatches on."""
    if not _has(q, 'symbols'):
        return []
    sf = site_file or (lambda x: x)
    read = _source_reader(q)
    consts = string_constants(q, read)[0] if consts is None else consts
    why = lambda key: f'registered in a handler table under "{key}" here — whoever dispatches the table by that key calls it, no call site does'
    out = set()
    by_line = collections.defaultdict(list)
    for i, f, l in q("""SELECT id, file, line FROM symbols WHERE method_id IS NOT NULL AND file IS NOT NULL AND line > 0
                         AND (is_test IS NULL OR is_test = 0) AND kind NOT IN ('module', 'constructor')"""):
        by_line[(f, l)].append(i)
    for (f, l), ids in by_line.items():
        L = read(f)
        if not L or l > len(L) or len(ids) != 1: continue
        m = _ENTRY_DECL.match(L[l - 1])
        key = _entry_key(m, consts) if m else None
        if key: out.add((ids[0], sf(f), l, 'table', key, why(key)))
    # an entry whose value NAMES the handler: the declaration a name identifies uniquely, as `registrations()` requires
    if _has(q, 'refs'):
        once = {}
        for n, i, c in q("""SELECT name, min(id), count(*) FROM symbols WHERE method_id IS NOT NULL AND name IS NOT NULL
                            AND name NOT LIKE '<%' GROUP BY name"""):
            if c == 1: once[n] = i
        tf = {x for (x,) in q("SELECT DISTINCT file FROM symbols WHERE is_test = 1 AND file IS NOT NULL")}
        for n, f, l in q("SELECT DISTINCT name, file, line FROM refs WHERE line > 0"):
            if n not in once or f in tf: continue
            L = read(f)
            if not L or l > len(L): continue
            m = _ENTRY_REF.match(L[l - 1])
            if not m or m.group(5).split('.')[-1] != n: continue
            key = _entry_key(m, consts)
            if key: out.add((once[n], sf(f), l, 'table', key, why(key)))
    return sorted(out)


def table_key_writes(q, keys, consts=None, cpos=None):
    """[(value, file, line)] — where a handler-table key in `keys` is WRITTEN: a literal of it, or a constant that
    resolves to it, outside a key position and outside the constant's own declaration. What a table's key is joined to."""
    if not keys:
        return []
    read = _source_reader(q)
    if consts is None or cpos is None:
        consts, cpos = string_constants(q, read)
    out = set()
    def written(text, token):
        for mm in re.finditer(re.escape(token), text):
            # a constant is not the tail of a longer name (`MY_TOPICS.X`) or the head of a longer chain (`TOPICS.X.y`)
            if token[0] not in '\'"`' and (re.match(r'[\w$]', text[mm.start() - 1:mm.start()] or ' ')
                                         or re.match(r'[\w$.]', text[mm.end():mm.end() + 1] or ' ')): continue
            if not _KEY_POS.match(text, mm.end()): return True
        return False
    if _has(q, 'literals'):
        for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL"):
            if v not in keys or (f, l) in cpos: continue
            L = read(f)
            text = L[l - 1] if L and l <= len(L) else None
            if text is None or written(text, f"'{v}'") or written(text, f'"{v}"') or written(text, f'`{v}`'):
                out.add((v, f, l))
    names = collections.defaultdict(set)                       # last segment -> the constants it may end
    for c, v in consts.items():
        if v in keys: names[c.split('.')[-1]].add(c)
    if names and _has(q, 'refs'):
        for n, f, l in q("SELECT DISTINCT name, file, line FROM refs WHERE line > 0"):
            if n not in names or (f, l) in cpos: continue
            L = read(f)
            if not L or l > len(L): continue
            for c in names[n]:
                if written(L[l - 1], c): out.add((consts[c], f, l))
    return sorted(out)


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
    table = collections.defaultdict(set)                    # a handler table's key -> the declarations it registers
    for decl, _f, _l, kind, key, _why in all_registrations(q, site_file):
        if decl and key:
            reg[key].add(decl)
            if kind == 'table': table[key].add(decl)
    if not reg:
        return []
    writes = collections.defaultdict(set)
    refused = route_literal_refused(q, at, site_file)
    for v, f, l in key_writes(q, set(table)):
        if not isinstance(v, str) or len(v) > 160: continue
        c = at(f, l)
        if c and c not in table.get(v, ()) and (c, v, f, l) not in refused: writes[v].add(c)
    # the rules' table_key: a table key's writers in test files drive its handler and are not counted against it
    tests = {i for (i,) in q("SELECT id FROM symbols WHERE is_test = 1 AND method_id IS NOT NULL")} if table else set()
    capped = {k for k, ds in reg.items() if len(ds) > cap} | {k for k, cs in writes.items()
                                                                if len(cs - tests if k in table else cs) > use_cap}
    out = set()
    for v, callers in writes.items():
        for key in route_candidates(v, reg):
            if key in capped: continue
            for c in callers:
                for d in reg[key]:
                    if c != d: out.add((c, d, key))
    return sorted(out)


def key_writes(q, table_keys=None):
    """[(value, file, line)] — every string a callable writes that a registration key may be joined to: the literals,
    except that a handler table's key is written where table_key_writes says (a dotted literal or a constant, never
    the table's own key position or the constant's declaration)."""
    if table_keys is None:
        table_keys = {r[4] for r in table_registrations(q)}
    rows = [(v, f, l) for v, f, l in q("SELECT value, file, line FROM literals WHERE line > 0 AND value IS NOT NULL")
            if v not in table_keys] if _has(q, 'literals') else []
    return rows + table_key_writes(q, table_keys)


# ── a servlet filter runs on every request of a test that loads it ───────────────────────────────────────────
# A filter has no caller in the source: the servlet container calls doFilter / doFilterInternal on every request the
# application serves, and a Spring MockMvc or web test serves its requests through the same chain. So a test that
# sends a request through a context holding the filter runs the filter's body, and nothing in the graph says so:
# `test-impact` after an edit to a filter's token parsing named no test while eight web-layer tests ran it on every
# request.
#
# The link is drawn only where the context is known to hold the filter, which keeps it narrow:
#   a filter INSTANCE handed to HttpSecurity addFilter / addFilterBefore / addFilterAfter / addFilterAt (a @Bean
#     factory's return, a `new`, or a field of the filter's type, written inside the call) is held by every context
#     that loads the configuration class declaring that call: a test naming it in @Import, @ContextConfiguration,
#     @SpringJUnitConfig or @SpringBootTest(classes = ...), or a @SpringBootTest with no classes (the whole
#     application). A @WebMvcTest slice alone is not credited: which configurations it picks up depends on the Boot
#     version, and a test that needs the security chain imports it.
#   a filter that is itself a @Component (or another stereotype) is held by a @SpringBootTest and by a @WebMvcTest
#     slice, which includes Filter beans, and by a test that imports it.
# and only for the test methods that send a request: a method that writes a path-shaped literal ("/orders") or calls
# a request method (MockMvc perform, a test client's exchange / getForEntity / ...). A test class that loads the
# configuration but sends nothing, and a test that sends requests without loading it, are not credited.
FILTER_BASES = {'OncePerRequestFilter', 'GenericFilterBean', 'HttpFilter', 'GenericFilter', 'AbstractAuthenticationProcessingFilter',
                'BasicAuthenticationFilter', 'UsernamePasswordAuthenticationFilter', 'AbstractPreAuthenticatedProcessingFilter'}
FILTER_IFACES = {'javax.servlet.Filter', 'jakarta.servlet.Filter'}
FILTER_ENTRY = {'doFilter', 'doFilterInternal', 'shouldNotFilter', 'attemptAuthentication', 'successfulAuthentication',
                'unsuccessfulAuthentication'}
FILTER_ADDERS = {'addFilter', 'addFilterBefore', 'addFilterAfter', 'addFilterAt'}
STEREOTYPES = {'Component', 'Service', 'Configuration'}
CONFIG_LOADERS = {'Import', 'ContextConfiguration', 'SpringJUnitConfig', 'SpringJUnitWebConfig', 'SpringBootTest'}
REQUEST_CALLS = {'perform', 'exchange', 'getForEntity', 'postForEntity', 'getForObject', 'postForObject', 'patchForObject'}
_CLASS_TOKEN = re.compile(r'\b([A-Z][\w$]*)\b')


def filter_links(q):
    """[(test method id, filter method id, how)] — the test sends a request through a context that holds the filter"""
    if not all(_has(q, t) for t in ('types', 'methods', 'type_ancestors', 'call_sites', 'decorations', 'symbols')): return []
    # cheap first: no ancestor named like a filter, no filter (the hooks ask this on every edit, graph_sql._has_framework_hops)
    if not q("SELECT 1 FROM type_ancestors WHERE ancestor_type_id LIKE '%Filter' LIMIT 1"): return []
    tname, qname = {}, {}
    for i, n, qn, prov in q("SELECT id, name, qualified_name, provenance FROM types"):
        if prov == 'client': tname[i] = n
        else: qname[i] = qn
    anc = collections.defaultdict(set)
    for t, a in q("SELECT type_id, ancestor_type_id FROM type_ancestors"): anc[t].add(a)
    def is_filter_base(a):
        if a in tname: return False                      # a client type: the chain continues through its own ancestors
        qn = (qname.get(a) or a.split(':', 1)[-1]).replace('$', '.')
        return qn in FILTER_IFACES or qn.rsplit('.', 1)[-1] in FILTER_BASES
    filters = {t for t in tname if any(is_filter_base(a) for a in anc.get(t, ()))}
    if not filters: return []
    entry = collections.defaultdict(set)                  # filter type -> the methods the container calls on it
    for mid, n, own in q("SELECT id, name, owner_type_id FROM methods WHERE owner_type_id IS NOT NULL"):
        if n not in FILTER_ENTRY: continue
        for f in filters:
            if own == f or own in anc.get(f, ()): entry[f].add(mid)
    filters = {f for f in filters if entry[f]}
    if not filters: return []
    by_name = collections.defaultdict(set)
    for f in filters: by_name[tname[f]].add(f)
    decs = collections.defaultdict(list)
    for o, n, text in q("SELECT owner_id, name, text FROM decorations"): decs[o].append((n.split('.')[-1], text or ''))
    # (1) handed to HttpSecurity inside a configuration class: config type -> filters it adds
    added = collections.defaultdict(set)
    owner_of = {mid: own for mid, own in q("SELECT id, owner_type_id FROM methods")}
    ret = {}
    for mid, sig, kind, own in q("SELECT id, signature, kind, owner_type_id FROM methods"):
        if 'CONSTRUCTOR' in (kind or '') and own in filters: ret[mid] = {own}
        elif sig and ':' in sig: ret[mid] = by_name.get(sig.rsplit(':', 1)[-1].strip(), set())
    ph = ','.join('?' * len(FILTER_ADDERS))
    for sid, caller, fp, l1, c1, l2, c2 in q(f"""SELECT id, caller_id, file_path, start_line, start_column, end_line, end_column
                                                FROM call_sites WHERE callee_name IN ({ph})""", *sorted(FILTER_ADDERS)):
        conf = owner_of.get(caller)
        if not conf: continue
        got = set()
        for isid, iname, ikind in q("""SELECT id, callee_name, kind FROM call_sites WHERE file_path = ? AND id <> ?
                                           AND (start_line > ? OR (start_line = ? AND start_column > ?))
                                           AND (end_line < ? OR (end_line = ? AND end_column <= ?))""", fp, sid, l1, l1, c1, l2, l2, c2):
            for (m,) in q("SELECT callee_method_id FROM call_edges WHERE call_site_id = ? AND callee_method_id IS NOT NULL", isid):
                got |= ret.get(m, set())
            if ikind and 'constructor' in ikind.lower(): got |= by_name.get((iname or '').split('.')[-1], set())
        if _has(q, 'refs') and _has(q, 'fields'):
            rel = [r[0] for r in q("SELECT file FROM symbols WHERE id = ?", caller)]
            if rel:
                for (n,) in q("SELECT DISTINCT name FROM refs WHERE file = ? AND line BETWEEN ? AND ? AND entity_kind = 'FIELD'", rel[0], l1, l2):
                    for (tn,) in q("SELECT type_name FROM fields WHERE name = ? AND owner_type_id = ?", n, conf):
                        got |= by_name.get(re.sub(r'<.*', '', tn or '').split('.')[-1], set())
        for f in got: added[conf].add(f)
    # (2) a filter that is a component of the application
    component = {f for f in filters if any(n in STEREOTYPES for n, _ in decs.get(f, ()))}
    if not added and not component: return []
    # the test classes, and what each one's context holds (its own decorations and its client ancestors')
    tests = collections.defaultdict(set)
    for i, own in q("""SELECT s.id, m.owner_type_id FROM symbols s JOIN methods m ON m.id = s.method_id
                       WHERE s.is_test = 1 AND m.owner_type_id IS NOT NULL"""): tests[own].add(i)
    cname = {t: tname[t] for t in set(added) | component}
    out = set()
    for t, ms in tests.items():
        ds = [d for x in [t] + sorted(a for a in anc.get(t, ()) if a in tname) for d in decs.get(x, ())]
        named = {tok for n, text in ds if n in CONFIG_LOADERS for tok in _CLASS_TOKEN.findall(text.split('(', 1)[1] if '(' in text else '')}
        whole = any(n == 'SpringBootTest' and not re.search(r'\bclasses\s*=', text) for n, text in ds)
        mvc = any(n == 'WebMvcTest' for n, _ in ds)
        held = {}
        for conf, fs in added.items():
            if whole or cname[conf] in named:
                for f in fs: held.setdefault(f, f"added to HttpSecurity in {cname[conf]}, which the test loads")
        for f in component:
            if whole or mvc or cname[f] in named: held.setdefault(f, f"a {tname[f]} component the test's context holds")
        if not held: continue
        for m in sorted(ms):
            if not _sends_request(q, m): continue
            for f, how in held.items():
                for e in entry[f]: out.add((m, e, how))
    return sorted(out)


def _sends_request(q, m):
    """the test method writes a path-shaped literal inside its own span, or calls a request method"""
    s = q("SELECT file, line, end_line FROM symbols WHERE id = ?", m)
    if not s or not s[0][1]: return False
    f, a, b = s[0][0], s[0][1], s[0][2] or s[0][1]
    ph = ','.join('?' * len(REQUEST_CALLS))
    if q(f"SELECT 1 FROM call_sites WHERE caller_id = ? AND callee_name IN ({ph}) LIMIT 1", m, *sorted(REQUEST_CALLS)): return True
    if _has(q, 'literals'):
        for (v,) in q("SELECT value FROM literals WHERE file = ? AND line BETWEEN ? AND ?", f, a, b):
            if isinstance(v, str) and re.fullmatch(r'/[\w\-./{}:%]*', v): return True
    return False
