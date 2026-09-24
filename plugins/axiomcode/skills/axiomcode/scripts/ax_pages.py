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
WEAK_ROW = re.compile(r'^\s{4}\[(by name|text|alongside|in scope)\]'
                      r'|^\s{6}\s?\d+ hop\(s\)  |^\s{6}… \+')     # low-certainty users, and entry-point lists, go last
QUALIFIER = re.compile(r'^\s{0,2}(verified:|bound:|note:|next:|through a call the engine could not resolve|outside the graph:)')
LABEL = (('reads or uses it', 'users'), ('produces or writes it', 'writers'), ('must change with it', 'contract'),
         ('reaches those', 'entry points'), ('bound from outside the source', 'non-source name matches'),
         ('tests:', 'tests'), ('depends on', 'dependencies'), ('where the work is', 'files'))


def paginate(text, page, budget, budget_flag='--budget'):
    lines = text.rstrip('\n').split('\n')
    if page == 'all' or len(text) <= budget * 4:
        return text
    head = []
    # a note printed BEFORE the answer says how to read all of it (a name that merged two declarations, a name that is
    # a field and a method): it stays on top of every page instead of sinking into the footer with the qualifiers
    while lines and lines[0].startswith('note:'):
        head.append(lines.pop(0))
    while lines and (lines[0].startswith('change:') or (head and lines[0].startswith('  ') and not lines[0].startswith('    '))):
        head.append(lines.pop(0))
    quals = [l for l in lines if QUALIFIER.match(l)]
    body = [l for l in lines if not QUALIFIER.match(l)]
    sections, cur = [], None                                   # a line at column 0 opens a section
    for l in body:
        if not l.startswith(' ') or cur is None:
            cur = [l, []]; sections.append(cur)
        else:
            cur[1].append(l)

    def totals_for(shown):
        out = []
        for title, rows in sections:
            if title.startswith('(') or not title.strip() or title in shown: continue
            out.append('  ' + title)
            out += ['    ' + r.strip() for r in rows if r.lstrip().startswith(('how sure each route', 'by hop:'))]
        return out

    strong, weak = [], []
    for title, rows in sections:
        keep = [r for r in rows if not WEAK_ROW.match(r)]
        low = [r for r in rows if WEAK_ROW.match(r)]
        if keep or not low: strong.append((title, keep))
        if low: weak.append((title + '  — low-certainty rows', low))
    fixed = sum(len(l) + 1 for l in head + quals) + sum(len(l) + 1 for l in totals_for(set())) + 400
    room = max(1500, budget * 4 - fixed)
    pages, cur, used = [], [], 0
    for title, rows in strong + weak:
        for i, l in enumerate([title] + rows):
            if used + len(l) + 1 > room and cur:
                pages.append(cur); cur, used = [], 0
                if i > 0: cur.append(title + '  (continued)'); used += len(title) + 13
            cur.append(l); used += len(l) + 1
    if cur: pages.append(cur)
    n = len(pages)
    if page < 1 or page > n:
        return f"page {page} does not exist: this answer has {n} page(s) at {budget_flag} {budget}\n"
    body = pages[page - 1]; rest = totals_for({l for l in body if not l.startswith(' ')})
    out = head + [f'page {page} of {n}:'] + body + ([''] + ['also in this answer (counts are for the whole answer):'] + rest if rest else []) + [''] + quals

    def short(t):
        weak_ = t.endswith('low-certainty rows')
        name = next((v for k, v in LABEL if t.startswith(k)), t.split(' (')[0].split(':')[0].strip()[:40])
        return ('[by name]/[text] ' if weak_ and name == 'users' else '') + name
    left = pages[page:]
    held = list(dict.fromkeys(short(re.sub(r'\s+\(continued\)$', '', l)) for pg in left for l in pg
                              if l and not l.startswith((' ', '('))))
    rows_left = sum(1 for pg in left for l in pg if l.startswith('    '))
    nxt = (f"{len(left)} more page(s) left, {rows_left} row(s): {', '.join(held) or 'the rest of the rows above'} — ask for them with "
           f"page={page + 1} (MCP) or --page {page + 1} (CLI), or all of it with --page all") if left else "this is the last page"
    out.append(f"page {page} of {n} (~{budget} tokens a page): {nxt}; {budget_flag} N changes the page size;"
               " narrow instead with --in <path>, --depth N or --tests-only")
    return '\n'.join(out) + '\n'


# ── next steps, read from the answer each verb printed ─────────────────────────────────────────────────────
LOC = r'([\w./-]+\.\w+:\d+)'

def next_path(text):
    sites = list(dict.fromkeys(re.findall(r'call @ ' + LOC + r'\]', text)))
    if sites:
        multi = ' — one hop is [multi_inferred], one of several candidates: check that call site only if the answer depends on which' if 'multi_inferred ·' in text else ''
        return (f"next: the chain is verified (every printed hop is an edge in the graph); read only its {len(sites)} call "
                f"site(s): {', '.join(sites[:6])}{' …' if len(sites) > 6 else ''}{multi}")
    rows = re.findall(r'^\s+(\d+) hop\(s\)\s+(\S+).*?\s' + LOC, text, re.M)
    if rows:
        near = min(int(h) for h, _, _ in rows)
        first = [(n, loc) for h, n, loc in rows if int(h) == near][:5]
        total = re.search(r'(\d+) (?:method|callable)s?\b', text)
        return (f"next: the nearest {'caller is' if len(first) == 1 else 'callers are'} at {near} hop(s): "
                + ', '.join(f"{n} {loc}" for n, loc in first)
                + (" — read it" if len(first) == 1 else " — read those") + "; farther hops matter only if these pass the change on"
                + (f" (of {total.group(1)} in all)" if total else ''))
    if re.search(r'no (chain|route|path)', text, re.I):
        return "next: no resolved chain — the unresolved sites named above are where one could hide; check those, not the whole tree"
    return ''

def next_context(text):
    m = re.search(r'^\s+(?:hop \d+|name only, no call path)\s+(\S+)\s+\(\d+ symbol\(s\)\)[^\n]*\n\s+-> ([^\n]+)', text, re.M)
    if not m: return ''
    f = m.group(1); syms = [x.strip() for x in m.group(2).split(',') if x.strip()][:2]
    return (f"next: read {f} first — it holds {' and '.join(syms)}; then `impact <the one you will change>` for what a change "
            "to it reaches. The other files are ranked context, not a reading list")

def next_changed(text):
    if re.search(r'^no change', text, re.M): return ''
    return "next: `test-impact` names the tests this edit reaches and the command that runs exactly those; `impact <target>` for a signature or field change above"

def next_test_impact(text):
    m = re.search(r'^\s*((?:\./gradlew|gradle|mvn|\./mvnw|npx|npm|pytest|python -m pytest|dotnet|go) [^\n]+)$', text, re.M)
    return f"next: run {m.group(1).strip()} — only the tests above; a test reached through reflection or a service loader is not among them" if m else ''

NEXT = {'path': next_path, 'context': next_context, 'changed': next_changed, 'test-impact': next_test_impact}


# a verb that already has a --budget of its own keeps it, and its page size is --page-budget: `context --budget N` is
# how many FILES to list, and taking it here turned `--budget 5` into a 5-token page of the default 12 files
OWN_BUDGET = {'context'}


def install(verb):
    """Capture this process's prose output; on exit, add the verb's next step and page it."""
    argv = sys.argv
    flag = '--page-budget' if verb in OWN_BUDGET else '--budget'
    page, budget = 1, PAGE_BUDGET                     # taken out of argv in every mode, --json included:
    if '--page' in argv:                              # the verb itself does not know these flags
        i = argv.index('--page'); v = argv[i + 1]; page = 'all' if v == 'all' else int(v); del argv[i:i + 2]
    if flag in argv:
        i = argv.index(flag); budget = int(argv[i + 1]); del argv[i:i + 2]
    if '--json' in argv:
        return
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
