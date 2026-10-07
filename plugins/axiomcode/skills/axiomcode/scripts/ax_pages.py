"""Pages and a next step for every verb's prose answer (#1198, #1202).

An agent keeps every answer in its context for the rest of its session, and treats a long answer as a list of
leads: on a question the graph had already answered, a run read six more files following callers an answer
listed. So every verb's prose is

  * PAGED at a fixed budget (~2000 tokens). The answer is still computed in full; every page carries the counts
    of the sections it does not show, the rows come strongest first, and the footer says how many pages are left,
    what they hold and how to ask for them;
  * CLOSED with one `next:` line -- what to read or run now, and what not to spend reads on.

`install(verb)` is one call at the top of a verb's `__main__`: it takes `--page` / `--budget` out of argv,
captures what the verb prints, and on exit writes the answer back paged, with the verb's next step appended when
the verb did not print its own. `--json` is never touched: a consumer parses the whole document.
"""
import atexit, collections, io, re, sys

PAGE_BUDGET = 2000                      # tokens per page, at ~4 characters a token
# low-certainty users go last, under their own heading; so do the entry-point lists (a sub-heading and its hop rows),
# which are not low-certainty and are headed as what they are
LOW_ROW = re.compile(r'^\s{4}\[(by name|text|alongside|in scope)\]')
ENTRY_ROW = re.compile(r'^\s{6}\s?\d+ hop\(s\)  |^\s{6}… \+|^\s{4}entry points \(')
WEAK_ROW = re.compile(LOW_ROW.pattern + '|' + ENTRY_ROW.pattern)
QUALIFIER = re.compile(r'^\s{0,2}(verified:|bound:|note:|next:|through a call the engine could not resolve|outside the graph:)')
LABEL = (('reads or uses it', 'users'), ('produces or writes it', 'writers'), ('must change with it', 'contract'),
         ('reaches those', 'entry points'), ('bound from outside the source', 'non-source name matches'),
         ('tests:', 'tests'), ('depends on', 'dependencies'), ('where the work is', 'files'))
RUNG = re.compile(r'^\s+\[([^\]]+)\]')
COUNTED = re.compile(r'^\s+\[[^\]]+\] |^\s+\d+ hop\(s\)  ')
# A VERB MAY MARK THE ROWS ITS DEFAULT VIEW HIDES (HIDE) AND THE LINES THAT SUMMARISE THEM (SUMM), e.g. impact's
# "… +54 more in 21 file(s)". Page 1 is the default view: every unmarked line, summaries included. Page 2 on are the
# rows page 1 did not print, the hidden ones included, and no summary: a later page that repeated "… +54 more"
# under nine new rows was the answer an agent got for asking for page 2 (rated not-good in 10 of 11 calls).
HIDE, SUMM = '\x01', '\x02'
CAPTURING = False                       # set by install(): a verb marks rows only when this pager reads its output


def _views(text):
    lines = text.rstrip('\n').split('\n')
    capped = [l[1:] if l.startswith(SUMM) else l for l in lines if not l.startswith(HIDE)]
    full = [l[1:] if l.startswith(HIDE) else l for l in lines if not l.startswith(SUMM)]
    return capped, full


def _parse(lines):
    lines = list(lines); head = []
    # a note printed BEFORE the answer says how to read all of it (a name that merged two declarations, a name that is
    # a field and a method): it stays on top of every page instead of sinking into the footer with the qualifiers
    while lines and lines[0].startswith('note:'):
        head.append(lines.pop(0))
    # impact --why prints, under each `change:` line, a block that says how the name was resolved: its first line is
    # indented like the other lines under `change:`, its detail deeper, and the whole block stays in the head
    why = False
    while lines:
        l = lines[0]
        if l.startswith('change:'): why = False
        elif head and l.startswith('  ') and not l.startswith('    '): why = l.startswith("  why '")
        elif not (why and l.startswith('    ')): break
        head.append(lines.pop(0))
    quals = [l for l in lines if QUALIFIER.match(l)]
    sections, cur = [], None                                   # a line at column 0 opens a section
    for l in (l for l in lines if not QUALIFIER.match(l)):
        if not l.startswith(' ') or cur is None:
            cur = [l, []]; sections.append(cur)
        else:
            cur[1].append(l)
    return head, quals, sections


def _name(title):
    return re.split(r' \(|:', title, maxsplit=1)[0].strip() or title.strip()


def _layout(sections, room, keep_empty):
    """pages of (section index, part, line): each section's strong rows first, then every section's weak rows. A
    section with no rows is kept (its heading is its content) only when keep_empty; on a later page it is dropped."""
    parts = []
    for i, (title, rows) in enumerate(sections):
        keep = [r for r in rows if not WEAK_ROW.match(r)]
        if keep or (keep_empty and not rows): parts.append((i, 'first', keep))
    for i, (title, rows) in enumerate(sections):
        low = [r for r in rows if LOW_ROW.match(r)]
        ent = [r for r in rows if ENTRY_ROW.match(r)]
        if low: parts.append((i, 'low', low))
        if ent: parts.append((i, 'entry', ent))
    pages, cur, used = [], [], 0
    for i, part, rows in parts:
        tlen = len(sections[i][0]) + 40
        if cur and used + tlen + (len(rows[0]) + 1 if rows else 0) > room:
            pages.append(cur); cur, used = [], 0
        used += tlen
        if not rows: cur.append((i, part, None))
        for r in rows:
            if used + len(r) + 1 > room and cur:
                pages.append(cur); cur, used = [], tlen
            cur.append((i, part, r)); used += len(r) + 1
    if cur: pages.append(cur)
    return pages


def _render(sections, items, whole_title):
    """the lines of one page: a heading over each run of rows. A section's own heading (the WHOLE answer's counts)
    heads its first rows on page 1; anywhere else the heading counts the rows printed under it, so the numbers on a
    page add up to what the page shows."""
    out, run = [], []
    def flush():
        if not run: return
        i, part = run[0][0], run[0][1]
        rows = [r for _, _, r in run if r is not None]
        title = sections[i][0]
        if not (part == 'first' and whole_title(i)):
            n = sum(1 for r in rows if COUNTED.match(r)) or len(rows)
            rungs = collections.Counter(m.group(1) for r in rows for m in [RUNG.match(r)] if m)
            what = f"{n} row(s)" + (': ' + ', '.join(f"{c} {k}" for k, c in rungs.most_common()) if rungs else '')
            title = _name(title) + {'first': f" (continued; on this page: {what})",
                                    'low': f" — low-certainty rows (on this page: {what})",
                                    'entry': f" — entry points (continued; on this page: {what})"}[part]
        out.append(title); out.extend(rows); run.clear()
    for it in items:
        if run and (it[0], it[1]) != (run[0][0], run[0][1]): flush()
        run.append(it)
    flush()
    return out


def _rows(lines):
    return sum(1 for l in lines if l.startswith('    '))


def paginate(text, page, budget, budget_flag='--budget'):
    capped, full = _views(text)
    ctext = '\n'.join(capped) + '\n'
    if page == 'all':
        return '\n'.join(full) + '\n'
    head, quals, sections = _parse(capped)

    def totals_for(shown):
        out = []
        for title, rows in sections:
            if title.startswith('(') or not title.strip() or title in shown: continue
            out.append('  ' + title)
            out += ['    ' + r.strip() for r in rows if r.lstrip().startswith(('how sure each route', 'by hop:'))]
        return out

    fixed = sum(len(l) + 1 for l in head + quals) + sum(len(l) + 1 for l in totals_for(set())) + 400
    room = max(1500, budget * 4 - fixed)
    # PAGE 1. An answer that fits is printed as it always was. AN EXPLANATION IS NOT SPLIT: its flow is a reading
    # order, sized when it is built; split, the second half is what nobody reads. Kept whole up to half a page over.
    whole = len(ctext) <= budget * 4 or ('how it runs —' in ctext and len(ctext) <= budget * 6)
    first = None if whole else _layout(sections, room, True)
    # an answer with no rows beyond its first page is not paged: a refusal or a note list longer than a page came back
    # as "page 1 of 2 ... 1 more page, 0 rows", a footer promising more of an answer that had none
    if first and len(first) > 1 and not any(r and r.startswith('    ') for pg in first[1:] for _, _, r in pg):
        whole, first = True, None
    p1 = first[0] if first else None
    # LATER PAGES: every row page 1 did not print, in the order of the full answer, under the section it belongs to
    on_p1 = collections.Counter((sections[i][0], r) for i, _, r in p1 if r) if p1 else \
        collections.Counter((t, r) for t, rows in sections for r in rows)
    _h, _q, fsections = _parse(full)
    rest = []
    for title, rows in fsections:
        left = []
        for r in rows:
            if on_p1[(title, r)] > 0: on_p1[(title, r)] -= 1
            else: left.append(r)
        rest.append([title, left])
    later = _layout(rest, room, False) if any(rows for _, rows in rest) else []
    n = 1 + len(later)
    if page == 1 and (whole or n == 1):
        return ctext if whole else '\n'.join(head + _render(sections, p1, lambda i: True) + [''] + quals) + '\n'
    if page < 1 or page > n:
        if n == 1:
            nr = _rows(capped)
            return (f"page {page} does not exist: this answer has 1 page, and the answer without --page printed all of it"
                    + (f" ({nr} row(s))" if nr else '') + "; nothing follows it\n")
        return f"page {page} does not exist: this answer has {n} page(s) at {budget_flag} {budget}\n"
    if page == 1:
        body = _render(sections, p1, lambda i: True)
    else:
        body = _render(rest, later[page - 2], lambda i: False)
    shown = {l for l in body if not l.startswith(' ')}
    rest_totals = totals_for(shown)
    out = head + [f'page {page} of {n}:'] + body + ([''] + ['also in this answer (counts are for the whole answer):'] + rest_totals if rest_totals else []) + [''] + quals

    def short(i, part, secs):
        name = next((v for k, v in LABEL if secs[i][0].startswith(k)), _name(secs[i][0])[:40])
        return ('[by name]/[text] ' if part == 'low' and name == 'users' else '') + name
    left = later[page - 1:]
    held = list(dict.fromkeys(short(i, part, rest) for pg in left for i, part, _ in pg))
    rows_left = sum(1 for pg in left for _, _, r in pg if r and r.startswith('    '))
    nxt = (f"{len(left)} more page(s) left, {rows_left} row(s): {', '.join(held) or 'the rest of the rows above'} — ask for "
           f"the next with --page {page + 1}, or all of it with --page all") if left else "this is the last page"
    out.append(f"page {page} of {n} (~{budget} tokens a page): {nxt}; {budget_flag} N changes the page size;"
               " narrow instead with --in <path>, --depth N or --tests-only")
    return '\n'.join(out) + '\n'


# ── next steps, read from the answer each verb printed ─────────────────────────────────────────────────────
LOC = r'([\w./-]+\.\w+:\d+)'

def next_path(text):
    sites = list(dict.fromkeys(re.findall(r'call @ ' + LOC + r'\]', text)))
    if sites:
        multi = ' — one hop is [multi_inferred], one of several candidates: check that call site only if the answer depends on which' if 'multi_inferred ·' in text else ''
        # a hop no call site makes (#1469) has no line in that list: its two ends are on the note under the chain
        if re.search(r'\[(remote|framework) · ', text):
            multi += (' — and a hop no call site makes ([remote] / [framework]): check it at the two ends its note names')
        return (f"next: the chain is verified (every printed hop is an edge in the graph); its {len(sites)} call "
                f"site(s): {', '.join(sites[:6])}{' …' if len(sites) > 6 else ''}{multi}. For a change, those sites are "
                "what to check; to explain how it works, read each hop's body — `context \"how does …\" --from <start>` "
                "prints the whole flow")
    rows = re.findall(r'^\s+(\d+) hop\(s\)\s+(\S+).*?\s' + LOC, text, re.M)
    if rows:
        near = min(int(h) for h, _, _ in rows)
        # each caller ONCE (#1389): the same caller is printed under "nearest callers" (at its call line) and again under
        # "entry points" (at its declaration), so the rows are keyed on the name and its FILE, not the line. Two callers
        # of one display name in two files are two callers, and stay two.
        seen_, first = set(), []
        for h, n, loc in rows:
            if int(h) == near and (n, loc.rsplit(':', 1)[0]) not in seen_:
                seen_.add((n, loc.rsplit(':', 1)[0])); first.append((n, loc))
        first = first[:5]
        total = re.search(r'(\d+) (?:method|callable)s?\b', text)
        return (f"next: the nearest {'caller is' if len(first) == 1 else 'callers are'} at {near} hop(s): "
                + ', '.join(f"{n} {loc}" for n, loc in first)
                + (" — read it" if len(first) == 1 else " — read those") + "; farther hops matter only if these pass the change on"
                + (f" (of {total.group(1)} in all)" if total else ''))
    # nothing resolved calls it, and impact's [by name] callers are listed (#1421): they are the only leads there are
    bn = re.findall(r'^\s+\[by name\] (\S+)\s+' + LOC, text, re.M)
    if bn:
        return (f"next: no resolved call reaches it; the {len(bn)} [by name] site(s) are leads, not calls: read "
                + ', '.join(f"{loc}" for _, loc in bn[:4]) + " and check whether the receiver there is this method's type")
    # a framework hop (#1509) is the connection when no call is: both ends are printed, so point at them
    fw = re.findall(r'a framework connects them: (\S+) ' + LOC + r' → (\S+) ' + LOC, text)
    if fw:
        a, la, b, lb = fw[0]
        return (f"next: no call connects them, the framework does: read {a} at {la}, where it hands over, and {b} at {lb}, "
                f"which the framework runs; `impact {b}` for everything else that depends on it")
    # WHAT FOLLOWS "no chain" DEPENDS ON WHY THERE IS NONE (#1385). The one sentence below used to close every
    # no-chain answer, and it named "the unresolved sites above" under answers that had printed none: under an
    # independent pair, and under one joined only by a library call.
    if 'which is the key it is registered under' in text:
        return ("next: the start writes the key the other is registered under (named above), so a framework connects "
                "them and no call does; the `impact … --tests` command printed there follows that hop")
    if 'an HTTP hop the graph did not link' in text:
        m = re.search(r'sends a request the graph does not follow: `[^`]*` in \S+ at (\S+:\d+)', text)
        return ("next: not shown to be independent — " + (f"read {m.group(1)}, " if m else "read the request named above, ")
                + "find the path and method it sends, and compare them with the routes named above; a route that serves "
                  "them is the connection")
    if 'NOT shown to be independent' in text:
        return ("next: no chain of calls; the library calls named above are where one could continue: read the body "
                "that makes them — one that publishes, schedules or registers what the entered method handles connects "
                "the two at run time")
    if 'connection is UNKNOWN, not absent' in text:
        m = re.search(r'^\s+`[^`]*` in \S+ at (\S+:\d+)', text, re.M)
        return ("next: not shown to be independent — " + (f"read {m.group(1)} and " if m else "read the calls through a value named above and ")
                + "find what its callee is given (the arguments its callers pass, what the loop runs over); a function handed "
                  "there is the connection")
    if 'the hop above is the only connection' in text:
        return "next: the cross-process hop above is the only connection; `impact <its target>` lists it as a [remote] dependent"
    # an endpoint a framework enters in a way the graph does not model: the check is the grep the verdict printed
    m = re.search(r'NOT CHECKED: (.+?) — a framework calls it.*?run: (grep [^\n]+)', text)
    if m:
        return (f"next: not shown to be independent — {m.group(1)}, and the graph does not model that framework's call; "
                f"run {m.group(2)} and read the site that registers or triggers it before treating the two as unconnected")
    if 'independent in this graph' in text:
        return ("next: nothing in this graph connects them — no call, no unresolved site that could, and no library call "
                "that could land on the other; for a connection through data (a table, a file, a message) look at what "
                "each writes and reads")
    if re.search(r'no (chain|route|path)', text, re.I):
        return ("next: no resolved chain — the graph loses the call at one of the unresolved sites named above, so the "
                "code may still connect them; read the start's body from those sites on")
    return ''

def next_context(text):
    # the question named something no graph here holds (#1571): the answer below it is about other code, so the first
    # step is that file, read directly
    b = re.search(r'^text files that name these declarations[^\n]*\n\s+(\S+:\d+)\s+names (\S+) \(([^)\n]+)\)', text, re.M)
    n = re.search(r'^not indexed: (\S+)', text, re.M)
    if b and 'how it runs —' not in text and (not n or b.group(1).startswith(n.group(1).rstrip('/'))):
        return (f"next: read {b.group(1)} — the text the question asks about, bound to {b.group(3)} by the name {b.group(2)}; "
                f"`impact {b.group(3)}` for everything else that depends on it")
    m = re.search(r'^not indexed: (\S+)', text, re.M)
    if m and not m.group(1)[0].isdigit():
        return (f"next: read {m.group(1)} directly (grep inside it) — the graph cannot see it, so the entries above match "
                "the question's other words, not that file")
    if m:
        ex = re.search(r'^not indexed: \d+ [^\n]*?\(e\.g\. ([^,;)\s]+)', text, re.M)
        return ("next: grep the files named on the first line directly" + (f" (start with {ex.group(1)})" if ex else "")
                + " — the graph cannot see them, so the entries above match the question's other words in the code it does hold")
    if 'how it runs —' in text:
        # an EXPLANATION: the flow is the reading order, and each step's body is the answer — a pointer list that
        # says "read only these" cut two measured explanations short at the first hops the graph printed
        locs = list(dict.fromkeys(re.findall(r'^\s+\d+ .*?\s' + LOC + r'\s*$', text, re.M)))
        gap = ' At every ⚠ the graph lost a call: read that body and follow the unresolved name (`path <name> \'*\'` continues from it).' if '⚠' in text else ''
        if re.search(r'^\s+\d+ \| ', text, re.M):
            return ("next: answer from the steps' code shown above, in order; open a file only for a step whose body was cut "
                    "(`… more line(s)`) or a call the flow could not follow." + gap)
        return (f"next: read the flow's steps in order — {', '.join(locs[:6])}{' …' if len(locs) > 6 else ''}; read each "
                "step's BODY, not only the line shown, since the body is the explanation and the flow is only its spine "
                "(`--source` prints it)." + gap)
    m = re.search(r'^\s+(?:hop \d+|name only, no call path)\s+(\S+)\s+\(\d+ symbol\(s\)\)[^\n]*\n\s+-> ([^\n]+)', text, re.M)
    if m:
        f = m.group(1); syms = [x.strip() for x in m.group(2).split(',') if x.strip()][:2]
        return (f"next: read {f} first — it holds {' and '.join(syms)}; then `impact <the one you will change>` for what a change "
                "to it reaches. The other files are ranked context, not a reading list")
    # --source prints each file's declarations as code (`name  (file:line)` and its lines) instead of the `->` list
    m = re.search(r'^\s+(?:hop \d+|name only, no call path)\s+(\S+)\s+\(\d+ symbol\(s\)\)[^\n]*\n((?:\s+\S+  \(\S+:\d+\)\n(?:\s+(?:\d+|) \| [^\n]*\n)*)+)',
                  text, re.M)
    if not m: return ''
    syms = re.findall(r'^\s+(\S+)  \(\S+:\d+\)$', m.group(2), re.M)[:2]
    return (f"next: answer from the code of {m.group(1)} shown first above — {' and '.join(syms)}; then `impact <the one you will "
            "change>` for what a change to it reaches. The other files are ranked context, not a reading list")

def next_changed(text):
    if re.search(r'^(no change|no git base)', text, re.M): return ''
    return "next: `test-impact` names the tests this edit reaches and the command that runs exactly those; `impact <target>` for a signature or field change above"

def next_test_impact(text):
    # a TypeScript selection can need one command per package and runner: `(cd pkg && npx tsx x.ts)` (#1570).
    # When a text tier adds the tests that load a changed fixture, it prints the command(s) for both after
    # "with the tests above:", and the first command alone left those tests out of the step an agent takes: the
    # LAST such block wins, with every command that continues it
    ms = list(re.finditer(r'^\s*(with the tests above: )?((?:\(cd \S+ && )?(?:\./gradlew|gradle|mvn|\./mvnw|npx|npm|pnpm|yarn|bun|node|tsx|pytest|python -m pytest|python manage\.py test|python -m unittest|python(?= \S+\.py$)|python3(?= \S+\.py\b)|bash(?= \S+\.sh\b)|dotnet|go) [^\n]+)$', text, re.M))
    if not ms: return ''
    last = max((i for i, m in enumerate(ms) if m.group(1)), default=0)
    cmds = [m.group(2).strip() for m in ms[last:]]
    what = cmds[0] if len(cmds) == 1 else f"the {len(cmds)} commands above, each from where it is written ({cmds[0]} …)"
    return f"next: run {what} — only the tests above; a test reached through reflection, a service loader or a subprocess is not among them"

NEXT = {'path': next_path, 'context': next_context, 'changed': next_changed, 'test-impact': next_test_impact}


# a verb that already has a --budget of its own keeps it, and its page size is --page-budget: `context --budget N` is
# how many FILES to list, and taking it here turned `--budget 5` into a 5-token page of the default 12 files
OWN_BUDGET = {'context'}
PAGE = 1


def install(verb):
    """Capture this process's prose output; on exit, add the verb's next step and page it."""
    argv = sys.argv
    flag = '--page-budget' if verb in OWN_BUDGET else '--budget'
    page, budget = 1, PAGE_BUDGET                     # taken out of argv in every mode, --json included:
    if '--page' in argv:                              # the verb itself does not know these flags
        i = argv.index('--page'); v = argv[i + 1]; page = 'all' if v == 'all' else int(v); del argv[i:i + 2]
    global PAGE
    PAGE = page                                       # a verb that shortens its default view reads this (impact collapses a [by name] flood)
    if flag in argv:
        i = argv.index(flag); budget = int(argv[i + 1]); del argv[i:i + 2]
    if '--json' in argv:
        return
    global CAPTURING
    CAPTURING = True
    real, buf = sys.stdout, io.StringIO()
    sys.stdout = buf

    def flush():
        sys.stdout = real
        text = buf.getvalue()
        if not text:
            return
        step = NEXT.get(verb, lambda t: '')(text) if not re.search(r'^\s{0,2}next:', text, re.M) else ''
        if step: text = text.rstrip('\n') + '\n' + step + '\n'
        real.write(paginate(text, page, budget, flag))
        real.flush()
    atexit.register(flush)
