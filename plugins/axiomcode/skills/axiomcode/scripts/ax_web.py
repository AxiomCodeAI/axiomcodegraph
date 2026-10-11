#!/usr/bin/env python3
"""ax_web.py — the query verbs on a WEB graph (HTML + CSS, `run.language = 'web'`).

A web graph has no call graph: its nodes are pages, elements, class tokens, ids, stylesheets, rules, selectors,
declarations, custom properties, @keyframes, @font-face, @layer, @container and scripts, and its edges are what a page
loads, what links where, which rules style which elements (match / conditional / unknown) and which declarations a
var() reaches (graph/bundle/web/schema.ts). Every verb script hands a web graph to this module first:

  impact <target>      .class  #id  --custom-prop  page.html  css/app.css  page.html:42 (the element there)
                       "@keyframes name"  "@font-face family"  "@layer name"  "@container name"  a selector as written
                       page.html#script-2 (an inline script)  [--in <page>] [--json]
  path <A> <B>         page -> sheet (link, @import), page -> page (links), --var -> use -> rule -> element, …
  context "<task>"     the web names the task's words land on, best first; the unused stylesheets, duplicated ids,
                       template-dialect pages when the task asks for them
  tests                a web graph selects no tests: exit 3, so a repository's other graphs answer alone

--json answers carry rows {at, kind, role, status, reason, rank, …} (SPEC §6.2): `at` is "file:line" or a file.

Per language: nothing here reads another language's graph, and no script text is read as JavaScript. A script's
resolved file and a handler's callee name are printed as written; the
JavaScript graph, asked by the same fan-out (ax_langs.py), answers for its own nodes.
"""
import json, os, re, sqlite3, sys
from collections import deque

ROWS = 25
CODE_LINES = 60          # lines of a script body an answer shows; the rest is cut and the row says so (`cut`)
INLINE = 'style=""'
STATUS_CERT = {'match': 'resolved', 'conditional': 'in scope', 'unknown': 'unknown', 'ambiguous': 'in scope'}


# ── the graph ────────────────────────────────────────────────────────────────

def graph_db(repo):
    gdir = os.environ.get('AXIOMCODE_GRAPH') or os.path.join(repo, '.axiomcode')
    return os.path.join(gdir, 'out', 'graph.sqlite')


def language_of(db):
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        r = con.execute("SELECT value FROM run WHERE key='language'").fetchone(); con.close()
        return r[0] if r else None
    except Exception:
        return None


def repo_of(args):
    skip = False; pos = []
    for a in args:
        if skip: skip = False; continue
        if a in ('--in', '--limit', '--depth', '--kind', '--budget', '--paths', '--page', '--from', '--seeds'): skip = True; continue
        if a.startswith('--') and not re.match(r'^--[A-Za-z_][\w-]*$', a): continue
        pos.append(a)
    return pos[-1] if pos and os.path.isdir(pos[-1]) else '.'


def maybe_answer(verb, argv):
    """called first by every verb script: answers and exits when the graph asked is a web graph, else returns"""
    if any(a in ('-h', '--help') for a in argv): return
    repo = repo_of(argv)
    db = graph_db(repo)
    if not os.path.isfile(db): return
    lang = language_of(db)
    if lang != 'web': return
    if '--warm' in argv: print("a web graph has no impact facts to precompute"); sys.exit(0)
    sys.exit(Web(db, repo).run(verb, argv))


def split_web(doc):
    """(the document without its web part, [web prose lines]) — for the front door (ax_blocks, ax_grep), which renders a
    call-graph answer as places with code: the web graph's answer is its prose, printed after the other languages'
    places under its own heading. The first item is None when only the web graph answered."""
    if not isinstance(doc, dict): return doc, []
    others = dict(doc.get('other_languages') or {})
    if doc.get('language') == 'web':
        rest = [(l, o) for l, o in others.items() if l != 'web']
        web = dict(doc); web.pop('other_languages', None)
        if not rest: return None, lines_of([web])
        l0, base = rest[0]
        base = dict(base) if isinstance(base, dict) else {'answer': base}
        base['language'] = l0
        if len(rest) > 1: base['other_languages'] = dict(rest[1:])
        return base, lines_of([web])
    if 'web' in others:
        web = others.pop('web')
        doc = dict(doc)
        if others: doc['other_languages'] = others
        else: doc.pop('other_languages', None)
        return doc, lines_of([web])
    return doc, []


def lines_of(docs):
    out = []
    for d in docs:
        if not isinstance(d, dict): continue
        p = d.get('prose') or ([d['refusal']] if d.get('refusal') else [])
        if p: out += ['', '══ web graph (HTML + CSS) ══'] + list(p)
    return out


def at_of(file, line=None):
    return f"{file}:{line}" if file and line else (file or '')


class Web:
    def __init__(self, db, repo):
        self.con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        self.con.row_factory = sqlite3.Row
        self.repo = repo
        self.IN = None
        self.limit = ROWS
        self.WHY = False

    def q(self, sql, *a):
        return self.con.execute(sql, a).fetchall()

    def q1(self, sql, *a):
        return self.con.execute(sql, a).fetchone()

    # ── dispatch ──
    def run(self, verb, argv):
        args = list(argv); as_json = '--json' in args; self.WHY = '--why' in args
        args = [a for a in args if a not in ('--json', '--tests', '--why', '--fresh', '--no-refresh', '--every', '--all', '--grep')]
        for flag in ('--in', '--limit', '--depth', '--kind', '--budget', '--paths', '--page', '--from', '--seeds'):
            while flag in args:
                i = args.index(flag); v = args[i + 1] if i + 1 < len(args) else ''
                del args[i:i + 2]
                if flag == '--in': self.IN = v.replace('\\', '/')
                if flag == '--limit':
                    try: self.limit = int(v) or 10 ** 9
                    except ValueError: pass
        if args and os.path.isdir(args[-1]) and (len(args) > (2 if verb == 'path' else 1) or verb == 'context'): args = args[:-1]
        if verb in ('tests', 'test-impact'):
            print("the web graph selects no tests (HTML and CSS have none); the other graphs answer for the edit")
            return 3
        if verb == 'changed':
            print("the web graph has no declarations to diff; `impact <page.html | sheet.css | .class>` answers for an edited page or stylesheet")
            return 3
        if verb == 'impact': doc = self.impact(args)
        elif verb == 'path': doc = self.path(args)
        elif verb == 'context': doc = self.context(args)
        else:
            print(f"web graph: no verb {verb}", file=sys.stderr); return 2
        doc['language'] = 'web'
        if as_json: print(json.dumps(doc, indent=1, default=str))
        else: print('\n'.join(doc.get('prose') or [doc.get('refusal', '')]))
        return 0 if doc.get('found') else 1

    # ── naming ──
    def scope_pages(self):
        if not self.IN: return None
        rows = self.q("SELECT uid FROM web_pages WHERE file = ? OR file LIKE ?", self.IN, '%' + self.IN.lstrip('./'))
        return {r['uid'] for r in rows}

    def in_page(self, col, host_col=None):
        """the --in filter on a page column; with host_col (web_styles.host_page_uid, §11) a fragment's rows matched where
        the page includes it count as the page's too"""
        sp = self.scope_pages()
        if sp is None: return '', []
        ph = ','.join('?' * len(sp)) or 'NULL'
        if host_col and self.has_col('web_styles', 'host_page_uid'):
            return f" AND ({col} IN ({ph}) OR {host_col} IN ({ph}))", list(sp) * 2
        return f" AND {col} IN ({ph})", list(sp)

    def has_col(self, table, col):
        key = (table, col)
        if not hasattr(self, '_cols'): self._cols = {}
        if key not in self._cols:
            try: self._cols[key] = any(r[1] == col for r in self.con.execute(f"PRAGMA table_info({table})"))
            except Exception: self._cols[key] = False
        return self._cols[key]

    def host_cols(self, alias='s'):
        """SQL columns naming the host a fragment row was matched in, and whether that include was asserted"""
        if not self.has_col('web_styles', 'host_page_uid'): return ", NULL AS host, 0 AS asserted"
        return (f", (SELECT file FROM web_pages WHERE uid = {alias}.host_page_uid) AS host, EXISTS (SELECT 1 FROM web_includes i WHERE i.host_page_uid = {alias}.host_page_uid"
                f" AND i.fragment_page_uid = {alias}.page_uid AND i.status = 'asserted') AS asserted")

    def classify(self, args):
        """[(kind, value)] for the targets written; an at-rule word joins the name after it"""
        out = []; i = 0
        while i < len(args):
            a = args[i]
            if a == '@media' and i + 1 < len(args): out.append(('media', ' '.join(args[i + 1:]))); break
            mm = re.match(r'^@media\s+(.+)$', a, re.S)
            if mm: out.append(('media', mm.group(1).strip())); i += 1; continue
            if a in ('@keyframes', '@font-face', '@layer', '@container') and i + 1 < len(args):
                k = {'@font-face': 'font'}.get(a, a[1:])
                if a == '@font-face': out.append((k, ' '.join(args[i + 1:]))); break
                out.append((k, args[i + 1])); i += 2; continue
            m = re.match(r'^@(keyframes|font-face|layer|container)\s+(.+)$', a)
            if m: out.append(({'font-face': 'font'}.get(m.group(1), m.group(1)), m.group(2).strip())); i += 1; continue
            out.append(self.kind_of(a)); i += 1
        return out

    def kind_of(self, a):
        if a.startswith('--') and len(a) > 2: return ('var', a)
        if a.startswith('component:'): return ('component', a[len('component:'):])
        if a.startswith('token:'): return ('token', a[len('token:'):])
        if re.match(r'^#[0-9a-fA-F]{3,8}$', a) and not self.q1("SELECT 1 FROM web_elements WHERE html_id = ? LIMIT 1", a[1:]) and self.q1("SELECT 1 FROM web_tokens WHERE value = ? LIMIT 1", self.norm_color(a)):
            return ('token', a)
        if re.match(r'^(rgba?|hsla?)\(', a, re.I): return ('token', a)
        if re.match(r'^.+\.(?:html?|xhtml|shtml?)#(?:script|on)-\d+$', a, re.I): return ('script', a)
        m = re.match(r'^(.+\.(?:html?|xhtml|shtml?|css)):(\d+)$', a, re.I)
        if m: return ('line', (m.group(1), int(m.group(2))))
        if re.match(r'^[^\s]+\.(html?|xhtml|shtml?)$', a, re.I): return ('page', a)
        if re.match(r'^[^\s]+\.css$', a, re.I): return ('sheet', a)
        # V2-09: a Tailwind class (`.dark:bg-gray-900`, `.w-1/2`, `.md\:flex` with its CSS escape) is a class when some
        # element carries that token, though it reads like a selector with a pseudo-class
        if a[:1] in '.#' and len(a) > 1:
            name = re.sub(r'\\(.)', r'\1', a[1:])
            if a[0] == '.' and not re.search(r'\s', name) and self.q1("SELECT 1 FROM web_class_tokens WHERE class_name = ? LIMIT 1", name): return ('class', name)
            if a[0] == '#' and not re.search(r'\s', name) and self.q1("SELECT 1 FROM web_elements WHERE html_id = ? LIMIT 1", name): return ('id', name)
        if self.q1("SELECT 1 FROM web_selectors WHERE selector_text = ? LIMIT 1", a) and (' ' in a or not re.match(r'^[.#][\w-]+$', a)): return ('selector', a)
        if re.match(r'^\.[^\s.#\[:>+~]+$', a): return ('class', a[1:])
        if re.match(r'^#[^\s.#\[:>+~]+$', a): return ('id', a[1:])
        for kind, sql, n in (('keyframes', "SELECT 1 FROM web_rules WHERE at_rule_name LIKE '%keyframes' AND name = ?", 1),
                             ('class', "SELECT 1 FROM web_class_tokens WHERE class_name = ?", 1),
                             ('id', "SELECT 1 FROM web_elements WHERE html_id = ?", 1),
                             ('layer', "SELECT 1 FROM web_rules WHERE at_rule_name = 'layer' AND (name = ? OR prelude_text = ?)", 2),
                             ('font', "SELECT 1 FROM web_font_use WHERE lower(name) = lower(?)", 1)):
            if self.q1(sql + " LIMIT 1", *([a] * n)): return (kind, a)
        return ('selector', a)

    def page_by_file(self, f):
        f = f.replace('\\', '/')
        f = f[2:] if f.startswith('./') else f
        return self.q("SELECT * FROM web_pages WHERE file = ? OR file LIKE ? ORDER BY length(file)", f, '%/' + f)

    def sheet_by_file(self, f):
        f = f.replace('\\', '/')
        f = f[2:] if f.startswith('./') else f
        return self.q("SELECT * FROM web_stylesheets WHERE source_kind='FILE' AND (file = ? OR file LIKE ?) ORDER BY length(file)", f, '%/' + f)

    # ── scripts and handlers, as markup and text ──
    def script_rows(self, where, *a, full=False):
        out = []
        for s in self.q(f"""SELECT s.file, s.line, s.order_on_page, s.script_kind, s.script_type, s.type_as_written, s.src, s.resolved_file, s.is_module,
                                 s.is_async, s.is_defer, s.is_nomodule, s.body_start_line AS body_line, s.body_lines, s.body_bytes, s.body, s.inline_index, s.attributes
                          FROM web_scripts s WHERE {where} ORDER BY s.file, s.order_on_page""", *a):
            body = s['body']; cut = 0
            cap = CODE_LINES if self.limit == ROWS else self.limit
            if body is not None and not full and cap < 10 ** 9:
                lines = body.split('\n')
                if len(lines) > cap: body = '\n'.join(lines[:cap]); cut = len(lines) - cap
            name = f"{s['file']}#script-{s['inline_index']}" if s['inline_index'] else None
            out.append(self.row(at_of(s['file'], s['line']), 'script', 'scripts', order=s['order_on_page'], name=name, script_kind=s['script_kind'],
                                script_type=s['script_type'], type=s['type_as_written'], src=s['src'], resolved_file=s['resolved_file'], module=bool(s['is_module']),
                                async_=bool(s['is_async']), defer=bool(s['is_defer']), nomodule=bool(s['is_nomodule']), body_line=s['body_line'],
                                body_lines=s['body_lines'], body_bytes=s['body_bytes'], body=body, cut=bool(cut), cut_lines=cut,
                                attributes=json.loads(s['attributes']) if s['attributes'] else None))
        return out

    def handler_rows(self, where, *a):
        # V2-01: `at` is the element's start tag; the handler attribute is `via_at`
        return [self.row(at_of(h['efile'] or h['file'], h['eline'] or h['line']), 'handler', 'handlers', tag=h['tag'], attr=h['attr_as_written'], event=h['event'],
                         modifiers=h['modifiers'] or None, source_kind=h['source_kind'], code=h['code'], code_bytes=h['code_bytes'], order=h['handler_index'],
                         via_at=at_of(h['file'], h['line']))
                for h in self.q(f"""SELECT h.file, h.line, h.tag, h.attr_as_written, h.event, h.modifiers, h.source_kind, h.code, h.code_bytes, h.handler_index,
                                   e.file efile, e.line eline FROM web_handlers h LEFT JOIN web_elements e ON e.uid = h.element_uid
                                   WHERE {where} ORDER BY h.file, h.handler_index""", *a)]

    def code_prose(self, prose, scripts, handlers):
        if scripts:
            prose.append(f"scripts, in page order: {len(scripts)}")
            for r in scripts[:self.limit]:
                head = f"  {r['order']}. {r['at']}: <script{' type=' + repr(r['type']) if r.get('type') else ''}{' module' if r.get('module') else ''}{' async' if r.get('async_') else ''}{' defer' if r.get('defer') else ''}>"
                if r['script_kind'] == 'EXTERNAL':
                    prose.append(head + f" src={r['src']}" + (f" → {r['resolved_file']}" if r.get('resolved_file') else ' (no such file)'))
                else:
                    prose.append(head + f" inline {r['name']} ({r['body_lines']} line(s), {r['body_bytes']} bytes)" + ('' if r['script_type'] in ('CLASSIC', 'MODULE') else f" [{r['script_type']}: not JavaScript]"))
                    for l in (r.get('body') or '').split('\n'): prose.append('      ' + l.rstrip('\r'))
                    if r.get('cut_lines'): prose.append(f"      … {r['cut_lines']} more line(s) — `impact {r['name']}` shows the whole body")
        if handlers:
            prose.append(f"event handlers, in page order: {len(handlers)}")
            for r in handlers[:self.limit]:
                prose.append(f"  {r['at']}: <{r['tag']} {r['attr']}=\"{r['code']}\">  [{r['source_kind']}{', event ' + r['event'] if r.get('event') else ''}{', ' + r['modifiers'] if r.get('modifiers') else ''}]")

    # ── rows and prose ──
    @staticmethod
    def row(at, kind, role, status='match', reason=None, **extra):
        r = {'at': at, 'kind': kind, 'role': role, 'status': status, 'reason': reason, 'certainty': STATUS_CERT.get(status, status)}
        r.update({k: v for k, v in extra.items() if v is not None})
        return r

    def section(self, prose, title, rows, fmt):
        prose.append(f"{title}: {len(rows)}")
        for r in rows[:self.limit]: prose.append('  ' + fmt(r))
        if len(rows) > self.limit: prose.append(f"  … +{len(rows) - self.limit} more (--limit 0 lists every row)")

    def finish(self, doc, rows):
        doc['rows'] = rows
        n = self.limit
        doc['more'] = 0
        return doc

    # ── impact ──
    def impact(self, args):
        if not args: return {'found': False, 'refusal': 'usage: impact <.class | #id | --prop | page.html | sheet.css | page.html:LINE | "@keyframes k" | "@font-face f" | selector>'}
        docs = []
        for kind, val in self.classify(args):
            docs.append(getattr(self, 'impact_' + kind)(val))
        if len(docs) == 1: return docs[0]
        return {'found': any(d.get('found') for d in docs), 'targets': docs, 'rows': [r for d in docs for r in d.get('rows', [])],
                'prose': [l for d in docs for l in (d.get('prose') or [d.get('refusal', '')]) + ['']]}

    def cascade_rows(self, element_uid, role='styled_by'):
        rows = self.q("""SELECT s.status, s.reason, s.conditions, s.pseudo_element, s.spec_a, s.spec_b, s.spec_c, s.layer_rank, s.sheet_order,
                   s.rule_order, s.important_count, sel.selector_text, sel.file, sel.line, st.display sheet, s.scope_root, ru.file rfile, ru.line rline
            FROM web_styles s JOIN web_selectors sel ON sel.uid = s.selector_uid JOIN web_stylesheets st ON st.uid = s.stylesheet_uid
            LEFT JOIN web_rules ru ON ru.uid = s.rule_uid
            WHERE s.element_uid = ? AND s.status != 'unknown'
            ORDER BY s.important_count > 0, s.layer_rank, s.spec_a, s.spec_b, s.spec_c, s.sheet_order, s.rule_order""", element_uid)
        out = []
        for i, r in enumerate(rows):
            # V2-01: `at` is the rule's own start; the selector that matched is `via_at`
            out.append(self.row(at_of(r['rfile'] or r['file'], r['rline'] or r['line']), 'styles', role, r['status'], r['reason'], rank=i + 1, selector=r['selector_text'],
                                via_at=at_of(r['file'], r['line']),
                                conditions=r['conditions'] or '-', important=r['important_count'] or 0, pseudo_element=r['pseudo_element'],
                                specificity=f"{r['spec_a']},{r['spec_b']},{r['spec_c']}", layer_rank=r['layer_rank'], sheet_order=r['sheet_order'],
                                rule_order=r['rule_order'], sheet=r['sheet']))
        return out

    @staticmethod
    def cascade_line(r):
        tag = r['status'] + (f" {r['reason']}" if r.get('reason') else '')
        extra = (f" ::{r['pseudo_element']}" if r.get('pseudo_element') else '') + (f" under {r['conditions']}" if r.get('conditions') not in (None, '-') else '') + \
                (" !important" if r.get('important') else '')
        return f"{r['rank']}. {r['at']}: {r['selector']}  ({r['specificity']}) [{tag}]{extra}"

    def impact_class(self, name):
        pf, pp = self.in_page('t.page_uid')
        els = self.q(f"""SELECT e.file, e.line, t.file tfile, t.line tline, e.display, e.inert, e.uid FROM web_class_tokens t JOIN web_elements e ON e.uid = t.element_uid
                        WHERE t.class_name = ? AND (e.inert IS NULL OR e.inert != 'iframe_text'){pf} ORDER BY t.file, t.line""", name, *pp)
        sels = self.q("""SELECT DISTINCT s.uid, s.selector_text, s.file, s.line, s.decidability, s.reason, s.pages_loading, s.pages_matched
                         FROM web_selector_parts sp JOIN web_selectors s ON s.uid = sp.selector_uid
                         WHERE sp.part_kind = 'CLASS' AND sp.name = ? ORDER BY s.file, s.line""", name)
        if not (els or sels): return {'found': False, 'kind': 'class', 'target': '.' + name, 'refusal': f"web graph: no element carries class '{name}' and no selector names it"}
        rows = [self.row(at_of(e['file'], e['line']), 'element', 'carries', 'conditional' if e['inert'] else 'match', f"inert:{e['inert']}" if e['inert'] else None, display=e['display'],
                         via_at=at_of(e['tfile'], e['tline'])) for e in els]
        rows += [self.row(at_of(s['file'], s['line']), 'selector', 'selectors', 'match' if s['decidability'] == 'exact' else ('conditional' if s['decidability'] == 'conditional' else 'unknown'),
                          s['reason'], selector=s['selector_text'], pages_loading=s['pages_loading'], pages_matched=s['pages_matched']) for s in sels]
        unknown = []
        if sels:
            ids = [s['uid'] for s in sels]; ph = ','.join('?' * len(ids))
            pf2, pp2 = self.in_page('s.page_uid')
            for u in self.q(f"""SELECT e.file, e.line, e.display, s.reason, sel.file sf, sel.line sl FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                                JOIN web_selectors sel ON sel.uid = s.selector_uid WHERE s.selector_uid IN ({ph}) AND s.status = 'unknown'{pf2}""", *(ids + pp2)):
                unknown.append(self.row(at_of(u['file'], u['line']), 'styles', 'unknown', 'unknown', u['reason'], selector_at=at_of(u['sf'], u['sl']), display=u['display']))
            pf3, pp3 = self.in_page('u.page_uid')
            for u in self.q(f"""SELECT u.reason, s.file, s.line, p.file page FROM web_unknown u JOIN web_selectors s ON s.uid = u.node_uid
                                LEFT JOIN web_pages p ON p.uid = u.page_uid WHERE u.node_uid IN ({ph}){pf3}""", *(ids + pp3)):
                unknown.append(self.row(at_of(u['file'], u['line']), 'selector', 'unknown', 'unknown', u['reason'], page=u['page']))
        rows += unknown
        # the selector `.name` itself, when a sheet writes it: the elements it matches (role styled), as `impact "X"` gives
        # for any selector (C-04): a single-class target must not lose the selector->element answer to the class lookup
        own = [s['uid'] for s in sels if s['selector_text'] == '.' + name]
        rows += self.styled_rows(own)
        wc = self.q1("SELECT * FROM web_classes WHERE class_name = ?", name)
        ic = self.q1("SELECT i.content, i.font_family, r.file, r.line FROM web_icon_classes i JOIN web_rules r ON r.uid = i.rule_uid WHERE i.class_name = ?", name)
        if wc:
            why = None if wc['styled'] else ('no rule names it' if not wc['selectors_naming'] else 'rules name it but none matches an element carrying it')
            rows.append(self.row(f".{name}", 'class', 'class', 'match' if wc['styled'] else 'unknown', why, name=name, styled=wc['styled'], elements=wc['elements'],
                                 selectors_naming=wc['selectors_naming'], selectors_matching=wc['selectors_matching'], icon=wc['icon']))
        prose = [f"web: class .{name}"]
        if wc: prose.append(f"styled: {'yes' if wc['styled'] else 'no — ' + why}" + (f"; icon: content {ic['content']}, font {ic['font_family'] or '-'} ({ic['file']}:{ic['line']})" if ic else ''))
        self.section(prose, f"elements carrying .{name}", [r for r in rows if r['role'] == 'carries'], lambda r: f"{r['at']}: {r['display']}" + (f" [{r['reason']}]" if r['reason'] else ''))
        self.section(prose, f"selectors naming .{name}", [r for r in rows if r['role'] == 'selectors'],
                     lambda r: f"{r['at']}: {r['selector']}  [loaded by {r['pages_loading']} page(s), matches on {r['pages_matched']}]")
        if own: self.section(prose, f"elements the selector .{name} styles", [r for r in rows if r['role'] == 'styled'], self.styled_line)
        if unknown: self.section(prose, "unknown (the bound)", unknown, lambda r: f"{r['at']}: {r['reason']}" + (f" {r.get('display', '')}" if r.get('display') else ''))
        return self.finish({'found': True, 'kind': 'class', 'target': '.' + name, 'prose': prose}, rows)

    def styled_rows(self, sel_uids):
        """role `styled`: the elements these selectors match (with --in: on the page, or included into it, §11)"""
        if not sel_uids: return []
        ph = ','.join('?' * len(sel_uids)); pf, pp = self.in_page('s.page_uid', 's.host_page_uid')
        return [self.row(at_of(r['file'], r['line']), 'element', 'styled', r['status'], r['reason'], display=r['display'],
                         **({'host': r['host']} if r['host'] else {}), **({'tier': 'asserted'} if r['asserted'] else {}))
                for r in self.q(f"""SELECT DISTINCT s.status, s.reason, e.file, e.line, e.display{self.host_cols()} FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                                   WHERE s.selector_uid IN ({ph}){pf} ORDER BY e.file, e.line""", *(list(sel_uids) + pp))]

    @staticmethod
    def styled_line(r):
        return (f"{r['at']}: {r['display']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]"
                + (f" (included in {r['host']})" if r.get('host') else '') + (" [asserted]" if r.get('tier') == 'asserted' else ''))

    def impact_id(self, value):
        pf, pp = self.in_page('e.page_uid')
        els = self.q(f"SELECT e.* FROM web_elements e WHERE e.html_id = ? AND (e.inert IS NULL OR e.inert != 'iframe_text'){pf} ORDER BY e.file, e.line", value, *pp)
        sels = self.q("""SELECT DISTINCT s.uid, s.selector_text, s.file, s.line FROM web_selector_parts sp JOIN web_selectors s ON s.uid = sp.selector_uid
                         WHERE sp.part_kind = 'ID' AND sp.name = ? ORDER BY s.file, s.line""", value)
        pf2, pp2 = self.in_page('r.page_uid')
        refs = self.q(f"""SELECT r.attribute_name, r.status, r.reason, f.file, f.line, f.display FROM web_id_refs r JOIN web_elements f ON f.uid = r.from_element_uid
                          WHERE r.id_value = ?{pf2} GROUP BY f.uid, r.attribute_name ORDER BY f.file, f.line""", value, *pp2)
        links = self.q("""SELECT DISTINCT f.file, f.line, f.display, l.url_as_written FROM web_links l JOIN web_elements f ON f.uid = l.from_element_uid
                          JOIN web_elements t ON t.uid = l.to_element_uid WHERE t.html_id = ?""", value)
        if not (els or sels or refs): return {'found': False, 'kind': 'id', 'target': '#' + value, 'refusal': f"web graph: no element has id '{value}' and no selector or reference names it"}
        per_page = {}
        for e in els: per_page.setdefault(e['page_uid'], []).append(e)
        rows = [self.row(at_of(e['file'], e['line']), 'element', 'carries', 'ambiguous' if len(per_page[e['page_uid']]) > 1 else 'match',
                         'duplicate_id' if len(per_page[e['page_uid']]) > 1 else None, display=e['display']) for e in els]
        rows += [self.row(at_of(s['file'], s['line']), 'selector', 'selectors', selector=s['selector_text']) for s in sels]
        rows += [self.row(at_of(r['file'], r['line']), 'element', 'referenced_by', r['status'], r['reason'], attribute=r['attribute_name'], display=r['display']) for r in refs]
        rows += [self.row(at_of(r['file'], r['line']), 'element', 'linked_from', url=r['url_as_written'], display=r['display']) for r in links]
        for e in els[:10]: rows += [dict(r, element=at_of(e['file'], e['line'])) for r in self.cascade_rows(e['uid'])]
        own = [s['uid'] for s in sels if s['selector_text'] == '#' + value]
        rows += self.styled_rows(own)   # C-04: the selector #value itself, as `impact "X"` answers any selector
        prose = [f"web: id #{value}"]
        self.section(prose, f"elements with id {value}", [r for r in rows if r['role'] == 'carries'], lambda r: f"{r['at']}: {r['display']}" + (' [duplicated on this page]' if r['reason'] else ''))
        self.section(prose, "rules styling them, in cascade order (last wins)", [r for r in rows if r['role'] == 'styled_by'], self.cascade_line)
        self.section(prose, f"selectors naming #{value}", [r for r in rows if r['role'] == 'selectors'], lambda r: f"{r['at']}: {r['selector']}")
        if own: self.section(prose, f"elements the selector #{value} styles", [r for r in rows if r['role'] == 'styled'], self.styled_line)
        self.section(prose, f"what points at #{value} on its page", [r for r in rows if r['role'] == 'referenced_by'],
                     lambda r: f"{r['at']}: {r['display']} [{r['attribute']}; {r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if links: self.section(prose, f"links from other pages to #{value}", [r for r in rows if r['role'] == 'linked_from'], lambda r: f"{r['at']}: {r['display']} → {r['url']}")
        return self.finish({'found': True, 'kind': 'id', 'target': '#' + value, 'prose': prose}, rows)

    def impact_line(self, fl):
        f, n = fl
        if f.lower().endswith('.css'):
            sh = self.sheet_by_file(f)
            if not sh: return {'found': False, 'refusal': f"web graph: no stylesheet {f}"}
            rows = self.q("SELECT uid, selector_text FROM web_selectors WHERE stylesheet_uid = ? AND line <= ? AND COALESCE(end_line, line) >= ? ORDER BY line DESC", sh[0]['uid'], n, n)
            if not rows: return {'found': False, 'refusal': f"web graph: no selector at {f}:{n}"}
            return self.impact_selector(rows[0]['selector_text'], sel_ids=[r['uid'] for r in rows])
        pg = self.page_by_file(f)
        if not pg: return {'found': False, 'refusal': f"web graph: no page {f}"}
        els = self.q("SELECT * FROM web_elements WHERE page_uid = ? AND line = ? ORDER BY col", pg[0]['uid'], n) or \
            self.q("SELECT * FROM web_elements WHERE page_uid = ? AND line <= ? AND end_line >= ? ORDER BY line DESC, col DESC LIMIT 1", pg[0]['uid'], n, n)
        if not els: return {'found': False, 'refusal': f"web graph: no element at {f}:{n}"}
        rows = []; prose = []
        for e in els:
            cas = self.cascade_rows(e['uid'])
            inline = self.q("SELECT property, value_text, is_important, line FROM web_declarations WHERE element_uid = ? ORDER BY position", e['uid'])
            rows += [dict(r, element=at_of(e['file'], e['line'])) for r in cas]
            rows += [self.row(at_of(e['file'], d['line']), 'declaration', 'inline_style', property=d['property'], value=d['value_text'], important=d['is_important']) for d in inline]
            el_scripts = self.script_rows('s.element_uid = ?', e['uid'], full=True)   # a script element: its whole body
            el_handlers = self.handler_rows('h.element_uid = ?', e['uid'])
            rows += el_scripts + el_handlers
            comp = self.computed_rows(e['uid'])
            rows += comp
            prose.append(f"web: element {e['display']} at {e['file']}:{e['line']}" + (f" (inert: {e['inert']})" if e['inert'] else ''))
            self.section(prose, "rules styling it in cascade order (last wins)", cas, self.cascade_line)
            self.section(prose, "computed: the winning declaration per property (inherited values are not filled; conditional-only properties marked)", [r for r in comp if r['role'] in ('computed', 'computed_conditional')],
                         lambda r: (f"{(r.get('pseudo') and '::' + r['pseudo'] + ' ') or ''}{r['property']}: {r.get('value')}  ← {r['at']} [{r['origin']}{', ' + r['status'] if r['status'] != 'match' else ''}{', overridden by shorthand at ' + r['override'] if r.get('override') else ''}]"
                                    if r.get('origin') else
                                    f"{(r.get('pseudo') and '::' + r['pseudo'] + ' ') or ''}{r['property']}: no unconditional winner [{r.get('reason') or r['status']}; {r.get('conditional_overrides') or 0} conditional declaration(s)]"))
            if self.WHY: self.section(prose, "cascade: every contender and why it lost", [r for r in comp if r['role'] == 'cascade'],
                                      lambda r: f"{(r.get('pseudo') and '::' + r['pseudo'] + ' ') or ''}{r['property']}: {r['at']} {r['outcome']}{' (' + r['lost_reason'] + ')' if r.get('lost_reason') else ''}")
            if inline: self.section(prose, "inline style (wins over every rule but !important)", inline,
                                    lambda d: f"{e['file']}:{d['line']}: {d['property']}: {d['value_text']}{' !important' if d['is_important'] else ''}")
            self.code_prose(prose, el_scripts, el_handlers)
        return self.finish({'found': True, 'kind': 'element', 'target': f"{f}:{n}", 'prose': prose}, rows)

    @staticmethod
    def norm_color(v):
        v = v.strip().lower()
        m = re.match(r'^#([0-9a-f]{3,8})$', v)
        if m:
            h = m.group(1)
            return '#' + (''.join(c + c for c in h) if len(h) in (3, 4) else h)
        return re.sub(r'\s+', '', v) if '(' in v else v

    def decl_at(self, uid):
        d = self.q1("SELECT file, line FROM web_declarations WHERE uid = ?", uid)
        return at_of(d['file'], d['line']) if d else uid

    def computed_rows(self, element_uid):
        out = []
        for c in self.q("""SELECT c.*, d.file, d.line FROM web_computed c LEFT JOIN web_declarations d ON d.uid = c.winner_decl_uid
                           WHERE c.element_uid = ? ORDER BY c.pseudo IS NOT NULL, c.pseudo, c.property""", element_uid):
            st = {'match': 'match', 'shorthand_override': 'conditional', 'conditional_only': 'conditional'}.get(c['winner_status'], 'unknown')
            out.append(self.row(at_of(c['file'], c['line']), 'declaration', 'computed' if c['winner_status'] in ('match', 'shorthand_override', 'unknown') else 'computed_conditional', st, None if c['winner_status'] == 'match' else c['winner_status'], property=c['property'],
                                pseudo=c['pseudo'], value=c['value_text'], origin=c['winner_origin'], important=c['important'], contenders=c['contenders'],
                                conditional_overrides=c['conditional_overrides'], override=self.decl_at(c['override_decl_uid']) if c['override_decl_uid'] else None))
        if self.WHY:
            for c in self.q("""SELECT w.*, d.file, d.line FROM web_cascade w JOIN web_declarations d ON d.uid = w.decl WHERE w.element = ?
                               ORDER BY w.pseudo IS NOT NULL, w.pseudo, w.property, w.rank""", element_uid):
                out.append(self.row(at_of(c['file'], c['line']), 'declaration', 'cascade', c['status'], c['lost_reason'], property=c['property'], pseudo=c['pseudo'],
                                    outcome=c['outcome'], lost_reason=c['lost_reason'], rank=c['rank'], conditions=c['conditions']))
        return out

    def impact_component(self, display):
        cs = self.q("SELECT * FROM web_components WHERE display = ? ORDER BY level = 'shape'", display) or \
            self.q("SELECT * FROM web_components WHERE display LIKE ? ORDER BY level = 'shape', occurrences DESC", display + '%')
        if not cs: return {'found': False, 'kind': 'component', 'target': display, 'refusal': f"web graph: no component candidate {display} (impact <page> lists a page's components)"}
        c = cs[0]
        occ = self.q("SELECT file, line, col, page_uid FROM web_component_occurrences WHERE component_uid = ? ORDER BY file, line, col", c['uid'])
        slots = self.q("SELECT * FROM web_component_slots WHERE component_uid = ? ORDER BY path, kind", c['uid'])
        rows = [self.row(at_of(o['file'], o['line']), 'element', 'occurrences') for o in occ]
        for sl in slots:
            kind = 'attr' if sl['kind'].startswith('attr:') else sl['kind']
            # the row's kind is the slot kind: text | attr | class
            rows.append(self.row(f"{occ[0]['file']}:{occ[0]['line']}" if occ else None, kind, 'slots', path=sl['path'] or '.', attribute_name=sl['attribute_name'] or '-',
                                 distinct_values=sl['distinct_values'], samples=json.loads(sl['samples'] or '[]')))
        styl = []
        if occ:
            root = self.q1("SELECT element_uid FROM web_component_occurrences WHERE component_uid = ? ORDER BY file, line, col LIMIT 1", c['uid'])
            styl = self.cascade_rows(root['element_uid'], role='styled_by')
            rows += styl
        rel = self.q("""SELECT display, level, 'contains' rel FROM web_components WHERE uid = ? UNION ALL
                         SELECT display, level, 'part' FROM web_components WHERE parent_component_uid = ?""", c['parent_component_uid'] or '', c['uid'])
        prose = [f"web: component candidate {c['display']} ({c['level']} level: {c['size']} elements, {c['occurrences']} occurrences on {c['pages']} page(s))"]
        self.section(prose, "occurrences", [r for r in rows if r['role'] == 'occurrences'], lambda r: r['at'])
        self.section(prose, "slots (what varies between occurrences: the props)", [r for r in rows if r['role'] == 'slots'],
                     lambda r: f"{r['path']} {r['kind']}{' ' + r['attribute_name'] if r.get('attribute_name') else ''}: {r['distinct_values']} values, e.g. {', '.join(map(str, r['samples'][:3]))}")
        if styl: self.section(prose, "rules styling the root (first occurrence), in cascade order", styl, self.cascade_line)
        for r in rel: prose.append(f"{'inside' if r['rel'] == 'contains' else 'contains'}: component {r['display']} ({r['level']})")
        return self.finish({'found': True, 'kind': 'component', 'target': c['display'], 'prose': prose}, rows)

    def impact_token(self, value):
        v = self.norm_color(value)
        toks = self.q("SELECT * FROM web_tokens WHERE value = ? OR value = ?", v, value.strip())
        if not toks: return {'found': False, 'kind': 'token', 'target': value, 'refusal': f"web graph: no declaration holds the value {value}"}
        rows = []; prose = []
        for t in toks:
            uses = self.q("""SELECT d.file, d.line, d.property, d.value_text, d.rule_uid, s.selector_text FROM web_token_uses u JOIN web_declarations d ON d.uid = u.declaration_uid
                             LEFT JOIN web_selectors s ON s.rule_uid = d.rule_uid AND s.position = 0 WHERE u.token_uid = ? ORDER BY d.file, d.line""", t['uid'])
            rows += [self.row(at_of(u['file'], u['line']), 'declaration', 'uses', property=u['property'], value=u['value_text'], selector=u['selector_text']) for u in uses]
            prose.append(f"web: {t['kind']} token {t['value']} — {t['uses']} use(s), {t['project_uses']} outside vendor sheets" + (f"; held by {t['vars']}" if t['vars'] else ''))
            self.section(prose, "used", [r for r in rows if r['role'] == 'uses'], lambda r: f"{r['at']}: {r.get('selector') or INLINE} {{ {r['property']}: {r.get('value')} }}")
        return self.finish({'found': True, 'kind': 'token', 'target': value, 'prose': prose}, rows)

    def impact_media(self, prelude):
        m = prelude.strip().lower()
        m = re.sub(r'\s+', ' ', m); m = re.sub(r'\(\s+', '(', m); m = re.sub(r'\s+\)', ')', m); m = re.sub(r'\s*:\s*', ':', m); m = re.sub(r'\s*,\s*', ',', m)
        b = self.q1("SELECT * FROM web_breakpoints WHERE media = ?", m)
        if not b: return {'found': False, 'kind': 'breakpoint', 'target': prelude, 'refusal': f"web graph: no @media {m}"}
        pf, pp = self.in_page('s.page_uid')
        els = self.q(f"""SELECT DISTINCT e.file, e.line, e.display, s.status FROM web_rule_breakpoints rb JOIN web_styles s ON s.rule_uid = rb.rule_uid
                          JOIN web_elements e ON e.uid = s.element_uid WHERE rb.breakpoint_uid = ? AND s.status != 'unknown'{pf} ORDER BY e.file, e.line""", b['uid'], *pp)
        rules = self.q("""SELECT r.file, r.line, r.prelude_text, rb.depth FROM web_rule_breakpoints rb JOIN web_rules r ON r.uid = rb.rule_uid
                           WHERE rb.breakpoint_uid = ? AND r.rule_kind = 'STYLE_RULE' ORDER BY r.file, r.line""", b['uid'])
        rows = [self.row(at_of(e['file'], e['line']), 'element', 'elements', 'conditional', 'at_rule:media', display=e['display']) for e in els]
        rows += [self.row(at_of(r['file'], r['line']), 'rule', 'rules', selector=r['prelude_text'], depth=r['depth']) for r in rules]
        rng = ', '.join(x for x in ((f"min {b['min_px']}px" if b['min_px'] is not None else ''), (f"max {b['max_px']}px" if b['max_px'] is not None else '')) if x)
        prose = [f"web: @media {b['media']}" + (f" ({rng}{', written in ' + b['unit'] if b['unit'] and b['unit'] != 'px' else ''})" if rng else '')]
        self.section(prose, "elements whose styles change under it", [r for r in rows if r['role'] == 'elements'], lambda r: f"{r['at']}: {r['display']}")
        self.section(prose, "rules under it", [r for r in rows if r['role'] == 'rules'], lambda r: f"{r['at']}: {r['selector']}")
        return self.finish({'found': True, 'kind': 'breakpoint', 'target': b['media'], 'prose': prose}, rows)

    def impact_selector(self, text, sel_ids=None):
        pf, pp = self.in_page('s.page_uid', 's.host_page_uid')
        sels = self.q("SELECT * FROM web_selectors WHERE uid IN (%s)" % ','.join('?' * len(sel_ids)), *sel_ids) if sel_ids else \
            self.q("SELECT * FROM web_selectors WHERE selector_text = ? ORDER BY file, line", text)
        if not sels: return {'found': False, 'kind': 'selector', 'target': text, 'refusal': f"web graph: nothing named '{text}' (not a class, id, custom property, page, stylesheet, @-name or selector)"}
        ids = [s['uid'] for s in sels]; ph = ','.join('?' * len(ids))
        styled = self.q(f"""SELECT DISTINCT s.status, s.reason, e.file, e.line, e.display{self.host_cols()} FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                            WHERE s.selector_uid IN ({ph}){pf} ORDER BY e.file, e.line""", *(ids + pp))
        rows = [self.row(at_of(s['file'], s['line']), 'selector', 'selectors', 'match' if s['decidability'] == 'exact' else 'conditional' if s['decidability'] == 'conditional' else 'unknown',
                         s['reason'], selector=s['selector_text'], specificity=f"{s['spec_a']},{s['spec_b']},{s['spec_c']}") for s in sels]
        rows += [self.row(at_of(r['file'], r['line']), 'element', 'styled', r['status'], r['reason'], display=r['display'],
                          **({'host': r['host']} if r['host'] else {}), **({'tier': 'asserted'} if r['asserted'] else {})) for r in styled]
        pf2, pp2 = self.in_page('page_uid')
        rows += [self.row(None, 'selector', 'unknown', 'unknown', u['reason']) for u in self.q(f"SELECT DISTINCT reason FROM web_unknown WHERE node_uid IN ({ph}){pf2}", *(ids + pp2))]
        prose = [f"web: selector {text}"]
        self.section(prose, "defined at", [r for r in rows if r['role'] == 'selectors'], lambda r: f"{r['at']}: {r['selector']} ({r['specificity']}) [{r['status']}]")
        self.section(prose, "elements it styles", [r for r in rows if r['role'] == 'styled'],
                     lambda r: f"{r['at']}: {r['display']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]"
                               + (f" (included in {r['host']})" if r.get('host') else '') + (" [asserted]" if r.get('tier') == 'asserted' else ''))
        for r in rows:
            if r['role'] == 'unknown': prose.append(f"  undecided on some page: {r['reason']}")
        return self.finish({'found': True, 'kind': 'selector', 'target': text, 'prose': prose}, rows)

    def impact_var(self, name):
        defs = self.q("""SELECT v.def_uid, v.rule_uid, v.attribute_uid, COALESCE(d.file, r.file) file, COALESCE(d.line, r.line) line, d.value_text,
                                (SELECT group_concat(s.selector_text, ', ') FROM web_selectors s WHERE s.rule_uid = v.rule_uid) selector
                         FROM web_var_def v LEFT JOIN web_declarations d ON d.uid = v.def_uid LEFT JOIN web_rules r ON r.uid = v.def_uid
                         WHERE v.name = ? ORDER BY 4, 5""", name)
        # uses, transitively through custom properties defined with var(name)
        seen = {name}; frontier = [name]; derived = []
        while frontier:
            n = frontier.pop()
            for r in self.q("SELECT DISTINCT d.property FROM web_uses_var u JOIN web_declarations d ON d.uid = u.declaration_uid WHERE u.name = ? AND d.is_custom = 1", n):
                if r['property'] not in seen: seen.add(r['property']); frontier.append(r['property']); derived.append(r['property'])
        direct = self.q("""SELECT DISTINCT d.uid, d.file, d.line, d.property, d.value_text, d.rule_uid, d.element_uid FROM web_uses_var u
                           JOIN web_declarations d ON d.uid = u.declaration_uid WHERE u.name = ? ORDER BY d.file, d.line""", name)
        every = self.q(f"""SELECT DISTINCT d.uid, d.file, d.line, d.property, d.value_text, d.rule_uid, d.element_uid, u.name FROM web_uses_var u
                           JOIN web_declarations d ON d.uid = u.declaration_uid WHERE u.name IN ({','.join('?' * len(seen))}) ORDER BY d.file, d.line""", *seen)
        if not (defs or direct): return {'found': False, 'kind': 'var', 'target': name, 'refusal': f"web graph: no declaration defines or uses {name}"}
        rule_ids = sorted({u['rule_uid'] for u in every if u['rule_uid']})
        pf, pp = self.in_page('s.page_uid')
        affected = self.q(f"""SELECT e.file, e.line, e.display, MIN(CASE s.status WHEN 'match' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END) st
                              FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                              WHERE s.rule_uid IN ({','.join('?' * len(rule_ids)) or 'NULL'}){pf} GROUP BY e.uid ORDER BY e.file, e.line""", *(rule_ids + pp)) if rule_ids else []
        pf2, pp2 = self.in_page('e.page_uid')
        inline_els = self.q(f"""SELECT DISTINCT e.file, e.line, e.display FROM web_declarations d JOIN web_elements e ON e.uid = d.element_uid
                                WHERE d.uid IN ({','.join('?' * len(every)) or 'NULL'}){pf2}""", *([u['uid'] for u in every] + pp2)) if every else []
        unresolved = self.q("SELECT reason, count(*) n FROM web_var_visible WHERE name = ? AND def_owner_uid IS NULL GROUP BY reason", name)
        rows = [self.row(at_of(d['file'], d['line']), 'var_def', 'defines', value=d['value_text'], selector=d['selector']) for d in defs]
        rows += [self.row(at_of(u['file'], u['line']), 'var_use', 'uses', property=u['property'], value=u['value_text']) for u in direct]
        rows += [self.row(at_of(u['file'], u['line']), 'var_use', 'uses_via', property=u['property'], value=u['value_text'], via=u['name']) for u in every if u['name'] != name]
        rows += [self.row(at_of(a['file'], a['line']), 'element', 'affects', ['match', 'conditional', 'unknown'][a['st']], display=a['display']) for a in affected]
        rows += [self.row(at_of(a['file'], a['line']), 'element', 'affects', reason='inline_style', display=a['display']) for a in inline_els]
        rows += [self.row(None, 'var_use', 'unknown', 'unknown', u['reason'], count=u['n']) for u in unresolved]
        prose = [f"web: custom property {name}"]
        self.section(prose, "defined", [r for r in rows if r['role'] == 'defines'], lambda r: f"{r['at']}: {r.get('selector') or INLINE} {{ {name}: {r.get('value')} }}")
        self.section(prose, "used", [r for r in rows if r['role'] == 'uses'], lambda r: f"{r['at']}: {r['property']}: {r.get('value')}")
        if derived: prose.append("custom properties defined through it: " + ', '.join(derived))
        self.section(prose, "elements a change reaches (styled by a rule using it, or its inline style)", [r for r in rows if r['role'] == 'affects'],
                     lambda r: f"{r['at']}: {r['display']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        for u in unresolved: prose.append(f"uses with no definition in scope: {u['n']} ({u['reason']})")
        return self.finish({'found': True, 'kind': 'var', 'target': name, 'prose': prose}, rows)

    def impact_sheet(self, f):
        sh = self.sheet_by_file(f)
        if not sh: return {'found': False, 'kind': 'stylesheet', 'target': f, 'refusal': f"web graph: no stylesheet {f} (a link to a file the walk did not read shows on the page that links it)"}
        s = sh[0]; sid = s['uid']
        loads = self.q("""SELECT p.file, l.via, l.load_order, l.import_depth, l.status, l.reason, l.media FROM web_loads l JOIN web_pages p ON p.uid = l.page_uid
                          WHERE l.stylesheet_uid = ? ORDER BY p.file""", sid)
        imports = self.q("""SELECT i.status, i.reason, i.url_as_written, t.file FROM web_imports i LEFT JOIN web_stylesheets t ON t.uid = i.to_stylesheet_uid
                            WHERE i.from_stylesheet_uid = ?""", sid)
        imported_by = self.q("SELECT f.file FROM web_imports i JOIN web_stylesheets f ON f.uid = i.from_stylesheet_uid WHERE i.to_stylesheet_uid = ?", sid)
        nrules = self.q1("SELECT count(*) n FROM web_rules WHERE stylesheet_uid = ?", sid)['n']
        per_page = self.q("""SELECT p.file, count(DISTINCT s.element_uid) n FROM web_styles s JOIN web_pages p ON p.uid = s.page_uid
                             WHERE s.stylesheet_uid = ? AND s.status != 'unknown' GROUP BY p.file ORDER BY p.file""", sid)
        unmatched = self.q("""SELECT sel.selector_text, sel.line, sel.file, sel.unknown_reason FROM web_selectors sel
                              WHERE sel.stylesheet_uid = ? AND sel.usage = 'unmatched_static' ORDER BY sel.line""", sid)
        urls = self.q("""SELECT v.name, v.resolved_file, v.line, v.file FROM web_value_refs v
                         WHERE v.stylesheet_uid = ? AND v.reference_kind = 'URL' ORDER BY v.line""", sid)
        gaps = self.q("SELECT gap_kind, detail, line FROM web_gaps WHERE owner_uid = ? ORDER BY line", sid)
        seen_pages = {}
        for l in loads: seen_pages.setdefault(l['file'], l)
        rows = [self.row(p, 'page', 'loaded_by', l['status'], l['reason'], via=l['via'], import_depth=l['import_depth'], load_order=l['load_order']) for p, l in seen_pages.items()]
        rows += [self.row(i['file'] or i['url_as_written'], 'stylesheet', 'imports', i['status'], i['reason']) for i in imports]
        rows += [self.row(r['file'], 'stylesheet', 'imported_by') for r in imported_by]
        rows += [self.row(at_of(u['file'], u['line']), 'selector', 'unmatched', 'unknown', u['unknown_reason'] or 'no_element_matches', selector=u['selector_text'], usage='unmatched_static') for u in unmatched]
        rows += [self.row(u['resolved_file'] or u['name'], 'file', 'uses_resource', 'match' if u['resolved_file'] else 'unknown', None if u['resolved_file'] else 'unresolved_url',
                          url=u['name'], line=u['line']) for u in urls if not (u['name'] or '').startswith('data:')]
        rows += [self.row(at_of(s['file'], g['line']), 'gap', 'gaps', 'unknown', g['gap_kind'], detail=g['detail']) for g in gaps]
        prose = [f"web: stylesheet {s['file']} ({nrules} rules{', vendor' if s['vendor'] else ''}{', minified' if s['minified'] else ''})"]
        self.section(prose, "pages that load it" + ('' if loads else ' — none: an orphan sheet'), [r for r in rows if r['role'] == 'loaded_by'],
                     lambda r: f"{r['at']}  [{r['via']}{', import depth ' + str(r['import_depth']) if r.get('import_depth') else ''}{'; ' + r['status'] + ' ' + (r['reason'] or '') if r['status'] != 'match' else ''}]")
        if imported_by: prose.append("imported by: " + ', '.join(r['file'] for r in imported_by))
        if imports: self.section(prose, "imports", [r for r in rows if r['role'] == 'imports'], lambda r: f"{r['at']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if per_page:
            prose.append("elements it styles, per page:")
            for p in per_page[:self.limit]: prose.append(f"  {p['file']}: {p['n']}")
        self.section(prose, "selectors that match nothing on any page loading it (unmatched_static: classes added at run time are outside the graph, so never 'dead')", [r for r in rows if r['role'] == 'unmatched'], lambda r: f"{r['at']}: {r['selector']}  [{r['reason']}]")
        if urls: self.section(prose, "url() references", [r for r in rows if r['role'] == 'uses_resource'], lambda r: f"{s['file']}:{r.get('line')}: {r['url']} → {r['at'] if r['status'] == 'match' else 'unresolved'}")
        if gaps: self.section(prose, "parse gaps", [r for r in rows if r['role'] == 'gaps'], lambda r: f"{r['at']}: {r['reason']} {r.get('detail') or ''}")
        return self.finish({'found': True, 'kind': 'stylesheet', 'target': s['file'], 'prose': prose}, rows)

    def skipped_note(self, f):
        # V1-02: a file the parser skipped (too large, unreadable) is in `skipped`, not silently absent
        try:
            r = self.q1("SELECT file_path AS file, reason FROM skipped WHERE file_path = ? OR file_path LIKE ? ORDER BY length(file_path) LIMIT 1", f, '%/' + f.lstrip('./'))
        except Exception:
            return None
        return f"web graph: {r['file']} was skipped by the parser ({r['reason']}): it has no elements, loads or styles in the graph" if r else None

    def impact_page(self, f):
        pg = self.page_by_file(f)
        if not pg: return {'found': False, 'kind': 'page', 'target': f, 'refusal': self.skipped_note(f) or f"web graph: no page {f}"}
        p = pg[0]; pid = p['uid']; pf = p['file']
        rows = []
        for r in self.q("""SELECT DISTINCT e.file, e.line, e.display, l.attribute_name FROM web_links l JOIN web_elements e ON e.uid = l.from_element_uid
                           WHERE l.to_page_uid = ? ORDER BY e.file, e.line""", pid):
            rows.append(self.row(at_of(r['file'], r['line']), 'element', 'linked_from', attribute=r['attribute_name'], display=r['display']))
        for i, l in enumerate(self.q("""SELECT l.via, l.load_order, l.import_depth, l.status, l.reason, l.url_as_written, l.media, s.display, s.file, s.source_kind, e.line eline
                          FROM web_loads l LEFT JOIN web_stylesheets s ON s.uid = l.stylesheet_uid LEFT JOIN web_elements e ON e.uid = l.via_uid
                          WHERE l.page_uid = ? ORDER BY l.load_order IS NULL, l.load_order""", pid)):
            if l['status'] == 'unknown':
                rows.append(self.row(at_of(pf, l['eline']) if l['via'] == 'link' else l['url_as_written'], 'stylesheet', 'unknown', 'unknown', l['reason'], url=l['url_as_written'], via=l['via']))
            else:
                # V2-10: a <style> element's `at` is file:line (its start tag); the display keeps `<style#n>`
                rows.append(self.row(l['file'] if l['source_kind'] == 'FILE' else at_of(pf, l['eline']) if l['via'] == 'style' and l['eline'] else l['display'], 'stylesheet', 'loads', l['status'], l['reason'], rank=l['load_order'], via=l['via'],
                                     import_depth=l['import_depth'], media=l['media'], display=l['display']))
        for s in self.q("""SELECT s.src, s.resolved_file, s.line, r.url_kind FROM web_scripts s
                           LEFT JOIN web_references r ON r.element_uid = s.element_uid AND r.attribute_name = 'src' WHERE s.page_uid = ? AND s.script_kind = 'EXTERNAL' ORDER BY s.line""", pid):
            if not s['resolved_file']:
                reason = 'external_url' if s['url_kind'] in ('ABSOLUTE', 'PROTOCOL_RELATIVE', 'OTHER_SCHEME') else 'template_url' if s['url_kind'] == 'TEMPLATE_EXPRESSION' else 'unresolved_url'
                rows.append(self.row(at_of(pf, s['line']), 'script', 'unknown', 'unknown', reason, url=s['src']))
        rows += self.script_rows('s.page_uid = ?', pid)
        rows += self.handler_rows('h.page_uid = ?', pid)
        for h in self.q("""SELECT h.event, h.callee_name, h.callee_text, h.handler_source, e.file, e.line, e.display FROM web_handler_calls h
                           LEFT JOIN web_elements e ON e.uid = h.element_uid WHERE h.page_uid = ? ORDER BY e.line, h.line, h.col""", pid):
            role = 'handler' if h['handler_source'] in ('EVENT_ATTRIBUTE', 'JAVASCRIPT_URL') else 'template_expr'
            rows.append(self.row(at_of(h['file'], h['line']), 'handler_call', role, calleeName=h['callee_name'], callee_text=h['callee_text'], event=h['event'],
                                 source=h['handler_source'], display=h['display']))
        tpl = self.q("""SELECT t.dialect, t.directive, t.expression_text, t.callee_names, e.file, e.line FROM web_template_exprs t
                        LEFT JOIN web_elements e ON e.uid = t.element_uid WHERE t.page_uid = ? ORDER BY e.line""", pid)
        have_tpl = {(r['at'], r.get('calleeName')) for r in rows if r['role'] == 'template_expr'}
        for t in tpl:
            for c in [c for c in (t['callee_names'] or '').split(',') if c]:
                if (at_of(t['file'], t['line']), c) not in have_tpl:
                    rows.append(self.row(at_of(t['file'], t['line']), 'template_expr', 'template_expr', calleeName=c, directive=t['directive'], dialect=t['dialect']))
        for d in self.q("""SELECT e.file, e.line, e.display, d.property, d.value_text FROM web_declarations d JOIN web_elements e ON e.uid = d.element_uid
                           WHERE d.page_uid = ? AND d.attribute_uid IS NOT NULL ORDER BY e.line, d.position""", pid):
            rows.append(self.row(at_of(d['file'], d['line']), 'declaration', 'inline_style', property=d['property'], value=d['value_text'], display=d['display']))
        for l in self.q("""SELECT e.line, e.display, l.attribute_name, l.status, l.reason, l.url_as_written, t.file FROM web_links l JOIN web_elements e ON e.uid = l.from_element_uid
                           LEFT JOIN web_pages t ON t.uid = l.to_page_uid WHERE l.page_uid = ? ORDER BY e.line""", pid):
            rows.append(self.row(at_of(pf, l['line']), 'element', 'links_to', l['status'], l['reason'], to=l['file'] or l['url_as_written'], display=l['display']))
        for fm in self.q("""SELECT e.uid, e.line, e.display, r.url_as_written, r.resolved_file FROM web_elements e
                            LEFT JOIN web_references r ON r.element_uid = e.uid AND r.attribute_name = 'action' WHERE e.page_uid = ? AND lower(e.tag_name) = 'form' ORDER BY e.line""", pid):
            names = self.q("""WITH RECURSIVE sub(u) AS (SELECT uid FROM web_elements WHERE parent_uid = ? UNION SELECT e.uid FROM web_elements e JOIN sub ON e.parent_uid = sub.u)
                              SELECT DISTINCT a.value FROM web_attributes a WHERE a.element_uid IN (SELECT u FROM sub) AND a.name = 'name' AND a.value IS NOT NULL""", fm['uid'])
            rows.append(self.row(at_of(pf, fm['line']), 'element', 'form', action=fm['resolved_file'] or fm['url_as_written'] or pf, names=sorted(n['value'] for n in names), display=fm['display']))
        for r in self.q("""SELECT r.kind, r.url, r.file, r.status, r.reason FROM web_resources r JOIN web_references ref ON ref.element_uid = r.from_uid AND ref.url_as_written = r.url
                           WHERE r.owner_uid = ? AND ref.reference_kind = 'LINK_RESOURCE' GROUP BY r.url ORDER BY r.url""", pid):
            rows.append(self.row(r['file'] or r['url'], 'file', 'uses_resource', r['status'], r['reason'], url=r['url'], resource_kind=r['kind']))
        for e in self.q("SELECT file, line, display, inert FROM web_elements WHERE page_uid = ? AND inert IS NOT NULL ORDER BY line", pid):
            rows.append(self.row(at_of(e['file'], e['line']), 'element', 'inert', 'conditional', f"inert:{e['inert']}", display=e['display']))
        for u in self.q("SELECT kind, reason, detail, line FROM web_unknown WHERE page_uid = ? AND node_uid = ?", pid, pid):
            rows.append(self.row(pf, 'page', 'unknown', 'unknown', u['reason']))
        # §9: what the page is built from
        comps = self.q("""SELECT c.uid, c.display, c.level, c.size, c.occurrences, c.pages, min(o.line) line FROM web_component_occurrences o JOIN web_components c ON c.uid = o.component_uid
                          WHERE o.page_uid = ? GROUP BY c.uid ORDER BY c.pages * c.size DESC""", pid)
        covered = set()
        for c in sorted(comps, key=lambda c: c['level'] != 'exact'):
            occ = {r['element_uid'] for r in self.q("SELECT element_uid FROM web_component_occurrences WHERE component_uid = ? AND page_uid = ?", c['uid'], pid)}
            if c['level'] == 'shape' and occ <= covered: continue  # its occurrences here are an exact group's: listed once
            if c['level'] == 'exact': covered |= occ
            rows.append(self.row(at_of(pf, c['line']), 'component', 'components', display=c['display'], level=c['level'], size=c['size'], occurrences=c['occurrences'], pages=c['pages']))
        for c in self.q("""SELECT c.*, e.line, e.display, l.display label_display FROM web_form_controls c JOIN web_elements e ON e.uid = c.element_uid
                          LEFT JOIN web_elements l ON l.uid = c.label_uid WHERE c.page_uid = ? ORDER BY e.line, e.col""", pid):
            rows.append(self.row(at_of(pf, c['line']), 'element', 'forms' if c['label_via'] == 'none' else 'form_controls', 'match', 'no_label' if c['label_via'] == 'none' else None,
                                 tag=c['tag'], type=c['type'], name=c['name'], required=c['required'], label_via=c['label_via'], label=c['label_text'], display=c['display']))
        for o in self.q("""SELECT o.*, e.line FROM web_outline o JOIN web_elements e ON e.uid = o.element_uid WHERE o.page_uid = ? ORDER BY o.ordinal""", pid):
            depth = 0; par = o['parent_outline_uid']
            while par:
                depth += 1; x = self.q1("SELECT parent_outline_uid FROM web_outline WHERE uid = ?", par); par = x['parent_outline_uid'] if x else None
            rows.append(self.row(at_of(pf, o['line']), o['kind'], 'outline', rank=o['ordinal'], name=o['name'], level=o['level'], label=o['label'], text=o['text'], depth=depth))
        for r in self.q("""SELECT r.*, p.line, p.display FROM web_repeats r JOIN web_elements p ON p.uid = r.parent_element_uid WHERE r.page_uid = ? ORDER BY p.line""", pid):
            sl = self.q("SELECT path, kind FROM web_component_slots WHERE component_uid = ?", r['uid'])
            rows.append(self.row(at_of(pf, r['line']), 'element', 'lists', count=r['count'], item_tag=r['item_tag'], item_classes=r['item_classes'], uniform=r['uniform'],
                                 display=r['display'], slots=[f"{x['path'] or '.'} {x['kind']}" for x in sl]))
        for b in self.q("""SELECT b.media, count(DISTINCT s.element_uid) n FROM web_breakpoints b JOIN web_rule_breakpoints rb ON rb.breakpoint_uid = b.uid
                           JOIN web_styles s ON s.rule_uid = rb.rule_uid WHERE s.page_uid = ? AND s.status != 'unknown' GROUP BY b.uid ORDER BY b.media""", pid):
            rows.append(self.row(pf, 'breakpoint', 'breakpoints', media=b['media'], elements=b['n']))
        # §11 fragment hosts (Q49, Q50): what the page includes, where; and, for a fragment, the hosts including it
        if self.has_col('web_includes', 'host_page_uid'):
            for r in self.q("""SELECT i.file, i.line, i.kind, i.status, i.reason, f.file frag FROM web_includes i LEFT JOIN web_pages f ON f.uid = i.fragment_page_uid
                               WHERE i.host_page_uid = ? AND i.kind != 'jinja:extends' ORDER BY i.line, i.col""", pid):
                rows.append(self.row(at_of(r['file'], r['line']), 'include', 'includes', r['status'], r['reason'], fragment=r['frag'], include_kind=r['kind']))
            for r in self.q("""SELECT i.file, i.line, i.kind, i.status, i.reason, h.file host FROM web_includes i LEFT JOIN web_pages h ON h.uid = i.host_page_uid
                               WHERE i.fragment_page_uid = ? ORDER BY i.file, i.line""", pid):
                rows.append(self.row(at_of(r['file'], r['line']), 'include', 'included_by', r['status'], r['reason'], host=r['host'], include_kind=r['kind']))
        prose = [f"web: page {pf}" + (f" — \"{p['title']}\"" if p['title'] else '') + (f" [{p['document_kind']}]" if p['document_kind'] != 'DOCUMENT' else '')]
        R = lambda role: [r for r in rows if r['role'] == role]
        if R('includes'): self.section(prose, "fragments it includes", R('includes'), lambda r: f"{r['at']}: {r.get('fragment') or '-'} [{r['include_kind']}, {r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if R('included_by'): self.section(prose, "included by", R('included_by'), lambda r: f"{r['at']}: {r.get('host') or '-'} [{r['include_kind']}, {r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        self.section(prose, "pages linking to it", R('linked_from'), lambda r: f"{r['at']}: {r['display']} [{r['attribute']}]")
        self.section(prose, "stylesheets it loads, in cascade order", R('loads'), lambda r: f"{r['rank']}. {r['display']}  [{r['via']}{', import depth ' + str(r['import_depth']) if r.get('import_depth') else ''}{', ' + r['media'] if r.get('media') else ''}{', ' + r['reason'] if r['reason'] else ''}]")
        self.code_prose(prose, R('scripts'), R('handlers'))
        if R('handler'): self.section(prose, "names the handlers call (as written)", R('handler'), lambda r: f"{r['at']}: on{r.get('event') or ''} → {r.get('callee_text') or r.get('calleeName')}")
        if R('template_expr'): self.section(prose, "template directives and the names they call", R('template_expr'), lambda r: f"{r['at']}: {r.get('directive') or r.get('source') or ''} → {r.get('calleeName')}")
        if tpl: prose.append(f"template expressions: {len(tpl)} ({', '.join(sorted({t['dialect'] for t in tpl}))})")
        if R('inline_style'): self.section(prose, "inline styles", R('inline_style'), lambda r: f"{r['at']}: {r['display']} {{ {r['property']}: {r.get('value')} }}")
        if R('form'): self.section(prose, "forms", R('form'), lambda r: f"{r['at']}: {r['display']} action={r['action']}  inputs: {', '.join(r['names'])}")
        if R('links_to'): self.section(prose, "links out", R('links_to'), lambda r: f"{r['at']}: {r['display']} → {r['to']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if R('uses_resource'): self.section(prose, "link resources (icon, preload, manifest)", R('uses_resource'), lambda r: f"{r['url']} → {r['at']} [{r['status']}]")
        if R('inert'): self.section(prose, "inert elements (inside <template>/<noscript>/<iframe> text)", R('inert'), lambda r: f"{r['at']}: {r['display']} [{r['reason']}]")
        if R('unknown'): self.section(prose, "unknown (what the page names that lands nowhere)", R('unknown'), lambda r: f"{r['at']}: {r['reason']}" + (f" {r['url']}" if r.get('url') else ''))
        if R('components'): self.section(prose, "components it is built from (impact component:<name> for slots)", R('components'), lambda r: f"{r['at']}: {r['display']} ({r['level']}, {r['size']} elements, {r['occurrences']}x on {r['pages']} page(s))")
        if R('outline'): self.section(prose, "outline (landmarks and headings, in order)", R('outline'), lambda r: f"{'  ' * r['depth']}{r['at']}: {r['name']}{' h' + str(r['level']) if r.get('level') else ''}{QUOTED(r.get('label') or r.get('text'))}")
        if R('forms') or R('form_controls'): self.section(prose, "form controls without a label", R('forms'), lambda r: f"{r['at']}: {r['display']} ({r['tag']}{' ' + r['type'] if r.get('type') else ''}{' name=' + r['name'] if r.get('name') else ''})")
        if R('lists'): self.section(prose, "repeated lists (a loop in a component)", R('lists'), lambda r: f"{r['at']}: {r['display']} > {r['count']} x {r['item_tag']}{'.' + r['item_classes'].replace(' ', '.') if r.get('item_classes') else ''}{'' if r['uniform'] else ' (items differ in classes)'}{'; varies: ' + ', '.join(r['slots']) if r.get('slots') else ''}")
        if R('breakpoints'): self.section(prose, "breakpoints styling it", R('breakpoints'), lambda r: f"@media {r['media']}: {r['elements']} element(s)")
        return self.finish({'found': True, 'kind': 'page', 'target': pf, 'prose': prose}, rows)

    def impact_script(self, a):
        page, _, frag = a.partition('#')
        m = re.match(r'(script|on)-(\d+)$', frag)
        pg = self.page_by_file(page)
        if not (m and pg): return {'found': False, 'kind': 'script', 'target': a, 'refusal': f"web graph: no inline script {a}"}
        if m.group(1) == 'script': rows = self.script_rows('s.page_uid = ? AND s.inline_index = ?', pg[0]['uid'], int(m.group(2)), full=True)
        else: rows = self.handler_rows('h.page_uid = ? AND h.handler_index = ?', pg[0]['uid'], int(m.group(2)))
        if not rows: return {'found': False, 'kind': 'script', 'target': a, 'refusal': f"web graph: no inline script {a}"}
        prose = [f"web: {a}"]
        self.code_prose(prose, [r for r in rows if r['role'] == 'scripts'], [r for r in rows if r['role'] == 'handlers'])
        return self.finish({'found': True, 'kind': 'script', 'target': a, 'prose': prose}, rows)

    def impact_keyframes(self, name):
        defs = self.q("SELECT file, line, at_rule_name, uid FROM web_rules WHERE at_rule_name LIKE '%keyframes' AND (name = ? OR trim(prelude_text, '\"''') = ?) ORDER BY file, line", name, name)
        uses = self.q("""SELECT DISTINCT d.uid, d.file, d.line, d.property, d.value_text, d.rule_uid FROM web_value_refs v JOIN web_declarations d ON d.uid = v.declaration_uid
                         WHERE v.reference_kind = 'KEYFRAMES' AND v.name = ? ORDER BY d.file, d.line""", name)
        if not (defs or uses): return {'found': False, 'kind': 'keyframes', 'target': name, 'refusal': f"web graph: no @keyframes {name} and no animation names it"}
        rule_ids = sorted({u['rule_uid'] for u in uses if u['rule_uid']})
        styled = self.q(f"""SELECT DISTINCT e.file, e.line, e.display, s.status FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                           WHERE s.rule_uid IN ({','.join('?' * len(rule_ids)) or 'NULL'}) AND s.status != 'unknown' ORDER BY e.file, e.line""", *rule_ids) if rule_ids else []
        rows = [self.row(at_of(d['file'], d['line']), 'keyframes', 'defines', at_rule=d['at_rule_name']) for d in defs]
        seen = set()
        for u in uses:
            k = at_of(u['file'], u['line'])
            if k in seen: continue
            seen.add(k); rows.append(self.row(k, 'declaration', 'uses', property=u['property'], value=u['value_text']))
        rows += [self.row(at_of(s['file'], s['line']), 'element', 'animates', s['status'], display=s['display']) for s in styled]
        prose = [f"web: @keyframes {name}"]
        self.section(prose, "defined", [r for r in rows if r['role'] == 'defines'], lambda r: f"{r['at']}: @{r['at_rule']} {name}")
        self.section(prose, "animations naming it", [r for r in rows if r['role'] == 'uses'], lambda r: f"{r['at']}: {r['property']}: {r.get('value')}")
        self.section(prose, "elements those rules animate", [r for r in rows if r['role'] == 'animates'], lambda r: f"{r['at']}: {r['display']} [{r['status']}]")
        return self.finish({'found': True, 'kind': 'keyframes', 'target': name, 'prose': prose}, rows)

    def impact_font(self, family):
        fam = family.strip().strip('"\'').lower()
        faces = self.q("""SELECT DISTINCT r.file, r.line, r.uid FROM web_rules r JOIN web_declarations d ON d.rule_uid = r.uid
                          WHERE r.at_rule_name = 'font-face' AND lower(d.property) = 'font-family' AND lower(trim(d.value_text, ' "''')) = ?""", fam)
        uses = self.q("""SELECT DISTINCT d.file, d.line, d.property, d.value_text FROM web_value_refs v JOIN web_declarations d ON d.uid = v.declaration_uid
                         LEFT JOIN web_rules r ON r.uid = d.rule_uid
                         WHERE v.reference_kind = 'FONT_FAMILY' AND lower(trim(v.name, ' "''')) = ? AND COALESCE(r.at_rule_name, '') != 'font-face' ORDER BY d.file, d.line""", fam)
        if not (faces or uses): return {'found': False, 'kind': 'font_face', 'target': family, 'refusal': f"web graph: no @font-face declares '{family}' and no font-family names it"}
        rows = [self.row(at_of(f['file'], f['line']), 'font_face', 'defines') for f in faces]
        rows += [self.row(at_of(u['file'], u['line']), 'declaration', 'uses', property=u['property'], value=u['value_text']) for u in uses]
        prose = [f"web: @font-face {family}"]
        self.section(prose, "declared by", [r for r in rows if r['role'] == 'defines'], lambda r: f"{r['at']}: @font-face")
        self.section(prose, "used by", [r for r in rows if r['role'] == 'uses'], lambda r: f"{r['at']}: {r['property']}: {r.get('value')}")
        return self.finish({'found': True, 'kind': 'font_face', 'target': family, 'prose': prose}, rows)

    def impact_layer(self, name):
        decl = self.q("""SELECT file, line, prelude_text FROM web_rules WHERE at_rule_name = 'layer'
                         AND (trim(prelude_text) = ? OR (',' || replace(prelude_text, ' ', '') || ',') LIKE ?) ORDER BY file, line""", name, '%,' + name + ',%')
        inside = self.q1("SELECT count(*) n FROM web_rules WHERE layer = ? OR layer LIKE ?", name, name + '.%')['n']
        if not decl and not inside: return {'found': False, 'kind': 'layer', 'target': name, 'refusal': f"web graph: no @layer {name}"}
        order = self.q("""SELECT DISTINCT s.layer_rank, r.layer FROM web_styles s JOIN web_rules r ON r.uid = s.rule_uid WHERE r.layer IS NOT NULL ORDER BY s.layer_rank""")
        rows = [self.row(at_of(d['file'], d['line']), 'layer', 'defines', prelude=d['prelude_text']) for d in decl]
        rows += [self.row(o['layer'], 'layer', 'layers', rank=o['layer_rank']) for o in order]
        prose = [f"web: @layer {name}", f"rules inside it: {inside}"]
        self.section(prose, "declared at", [r for r in rows if r['role'] == 'defines'], lambda r: f"{r['at']}: @layer {r['prelude']}")
        if order: prose.append("layers in cascade order (weakest first): " + ', '.join(o['layer'] for o in order))
        return self.finish({'found': True, 'kind': 'layer', 'target': name, 'prose': prose}, rows)

    def impact_container(self, name):
        uses = self.q("""SELECT DISTINCT c.status, c.reason, r.file, r.line, r.prelude_text, d.file dfile, d.line dline FROM web_container_use c
                         JOIN web_rules r ON r.uid = c.use_uid LEFT JOIN web_declarations d ON d.uid = c.target_uid WHERE c.name = ?""", name)
        if not uses: return {'found': False, 'kind': 'container', 'target': name, 'refusal': f"web graph: no @container {name}"}
        rows = [self.row(at_of(u['file'], u['line']), 'rule', 'uses', u['status'], u['reason'], prelude=u['prelude_text']) for u in uses]
        rows += [self.row(at_of(u['dfile'], u['dline']), 'declaration', 'defines') for u in uses if u['dfile']]
        prose = [f"web: @container {name}"] + [f"  {r['at']}: {r['role']}" for r in rows]
        return self.finish({'found': True, 'kind': 'container', 'target': name, 'prose': prose}, rows)

    # ── path ──
    def endpoint(self, a):
        kind, v = self.kind_of(a)
        if kind == 'page': return [('page', r['uid']) for r in self.page_by_file(v)]
        if kind == 'sheet': return [('sheet', r['uid']) for r in self.sheet_by_file(v)]
        if kind == 'class': return [('el', r['element_uid']) for r in self.q("SELECT element_uid FROM web_class_tokens WHERE class_name = ?", v)]
        if kind == 'id': return [('el', r['uid']) for r in self.q("SELECT uid FROM web_elements WHERE html_id = ?", v)]
        if kind == 'var': return [('var', v)]
        if kind == 'line':
            f, n = v; pg = self.page_by_file(f)
            return [('el', r['uid']) for r in self.q("SELECT uid FROM web_elements WHERE page_uid = ? AND line = ?", pg[0]['uid'], n)] if pg else []
        if kind == 'keyframes': return [('rule', r['uid']) for r in self.q("SELECT uid FROM web_rules WHERE at_rule_name LIKE '%keyframes' AND name = ?", v)]
        if kind == 'selector': return [('sel', r['uid']) for r in self.q("SELECT uid FROM web_selectors WHERE selector_text = ?", v)]
        return []

    def neighbours(self, node, edges):
        k, v = node; q = self.q
        if k == 'page':
            if 'loads' in edges:
                for r in q("SELECT DISTINCT stylesheet_uid FROM web_loads WHERE page_uid = ? AND stylesheet_uid IS NOT NULL AND via != 'import'", v): yield ('sheet', r['stylesheet_uid']), 'loads'
            if 'links' in edges:
                for r in q("SELECT DISTINCT to_page_uid FROM web_links WHERE page_uid = ? AND to_page_uid IS NOT NULL", v): yield ('page', r['to_page_uid']), 'links to'
            if 'contains' in edges:
                for r in q("SELECT uid FROM web_elements WHERE page_uid = ?", v): yield ('el', r['uid']), 'contains'
        elif k == 'sheet':
            if 'loads' in edges:
                for r in q("SELECT DISTINCT to_stylesheet_uid FROM web_imports WHERE from_stylesheet_uid = ? AND to_stylesheet_uid IS NOT NULL", v): yield ('sheet', r['to_stylesheet_uid']), '@import'
            if 'rules' in edges:
                for r in q("SELECT uid FROM web_rules WHERE stylesheet_uid = ? AND rule_kind = 'STYLE_RULE'", v): yield ('rule', r['uid']), 'contains rule'
        elif k == 'rule':
            for r in q("SELECT uid FROM web_selectors WHERE rule_uid = ?", v): yield ('sel', r['uid']), 'selector'
        elif k == 'sel':
            for r in q("SELECT DISTINCT element_uid, status FROM web_styles WHERE selector_uid = ? AND status != 'unknown'", v): yield ('el', r['element_uid']), f"styles [{r['status']}]"
        elif k == 'var':
            for r in q("SELECT def_uid FROM web_var_def WHERE name = ?", v): yield ('def', r['def_uid']), 'defined by'
        elif k == 'def':
            for n in q("SELECT name FROM web_var_def WHERE def_uid = ?", v):
                for r in q("SELECT DISTINCT declaration_uid FROM web_uses_var WHERE name = ?", n['name']): yield ('use', r['declaration_uid']), 'used by'
        elif k == 'use':
            for r in q("SELECT rule_uid, element_uid, property, is_custom FROM web_declarations WHERE uid = ?", v):
                if r['rule_uid']: yield ('rule', r['rule_uid']), 'in rule'
                if r['element_uid']: yield ('el', r['element_uid']), 'inline style of'
                if r['is_custom']: yield ('var', r['property']), 'defines'
        elif k == 'el':
            if 'links' in edges:
                for r in q("SELECT DISTINCT to_page_uid FROM web_links WHERE from_element_uid = ? AND to_page_uid IS NOT NULL", v): yield ('page', r['to_page_uid']), 'links to'
            for r in q("SELECT DISTINCT to_element_uid FROM web_id_refs WHERE from_element_uid = ? AND to_element_uid IS NOT NULL", v): yield ('el', r['to_element_uid']), 'refers to'

    def label(self, node):
        k, v = node
        if k == 'page': r = self.q1("SELECT file FROM web_pages WHERE uid = ?", v); return (r['file'], None, r['file'], 'page') if r else (None, None, v, k)
        if k == 'sheet': r = self.q1("SELECT display, file, source_kind, line FROM web_stylesheets WHERE uid = ?", v); return ((r['file'] if r['source_kind'] == 'FILE' else r['file']), (None if r['source_kind'] == 'FILE' else r['line']), r['display'], 'stylesheet') if r else (None, None, v, k)
        if k == 'rule':
            r = self.q1("SELECT r.file, r.line, group_concat(s.selector_text, ', ') t FROM web_rules r LEFT JOIN web_selectors s ON s.rule_uid = r.uid WHERE r.uid = ?", v)
            return (r['file'], r['line'], f"rule {r['t'] or ''}", 'rule') if r else (None, None, v, k)
        if k == 'sel': r = self.q1("SELECT file, line, selector_text FROM web_selectors WHERE uid = ?", v); return (r['file'], r['line'], r['selector_text'], 'selector') if r else (None, None, v, k)
        if k == 'el': r = self.q1("SELECT file, line, display FROM web_elements WHERE uid = ?", v); return (r['file'], r['line'], r['display'], 'element') if r else (None, None, v, k)
        if k in ('def', 'use'):
            r = self.q1("SELECT file, line, property, value_text FROM web_declarations WHERE uid = ?", v)
            if r: return (r['file'], r['line'], f"{r['property']}: {r['value_text']}", 'var_def' if k == 'def' else 'var_use')
            r = self.q1("SELECT file, line, prelude_text FROM web_rules WHERE uid = ?", v)
            return (r['file'], r['line'], f"@property {r['prelude_text']}", 'var_def') if r else (None, None, v, k)
        return (None, None, v, k)

    def path(self, args):
        pos = [a for a in args if not os.path.isdir(a)] if len(args) > 2 else args
        if len(pos) < 2: return {'found': False, 'refusal': 'usage: path <A> <B>  (page.html, sheet.css, .class, #id, --prop, page.html:LINE, selector)'}
        A, B = pos[0], pos[1]
        src, dst = self.endpoint(A), set(self.endpoint(B))
        if not src: return {'found': False, 'refusal': f"web graph: nothing named '{A}'"}
        if not dst: return {'found': False, 'refusal': f"web graph: nothing named '{B}'"}
        kb = self.kind_of(B)[0]; ka = self.kind_of(A)[0]
        # the edges a question of this shape follows: page -> page by links; page -> sheet by link/@import; otherwise all
        if ka == 'page' and kb == 'page': edges = {'links'}
        elif ka in ('page', 'sheet') and kb == 'sheet': edges = {'loads', 'links'}
        else: edges = {'loads', 'links', 'rules', 'contains'}
        scope = self.scope_pages()
        prev = {s: None for s in src}; dq = deque(src); hits = [s for s in src if s in dst]
        while dq and len(hits) < 5 and len(prev) < 200000:
            n = dq.popleft()
            for m, how in self.neighbours(n, edges):
                if m in prev: continue
                if scope and m[0] == 'page' and m[1] not in scope and m not in dst: continue
                prev[m] = (n, how); dq.append(m)
                if m in dst: hits.append(m)
        if not hits: return {'found': False, 'from': A, 'to': B, 'refusal': f"web graph: no chain from {A} to {B} (links, loads, @import, rules, selectors, styles, var() and id references followed)", 'chains': []}
        chains = []; prose = [f"web: {A} → {B}"]
        for h in hits[:5]:
            hops = []; n = h
            while prev.get(n):
                p, how = prev[n]; hops.append((p, how, n)); n = p
            hops.reverse()
            chain = []
            f, l, t, kd = self.label(hops[0][0] if hops else h)
            chain.append({'at': at_of(f, l), 'kind': kd, 'role': 'start', 'node': t, 'status': 'match'})
            for p, how, n2 in hops:
                f, l, t, kd = self.label(n2)
                role = 'links_to' if how == 'links to' else 'loads' if how in ('loads', '@import') else how
                chain.append({'at': at_of(f, l), 'kind': kd, 'role': role, 'how': how, 'node': t, 'status': 'conditional' if 'conditional' in how else 'match'})
            chains.append(chain)
            prose.append(f"chain ({len(chain) - 1} hop(s)):")
            for c in chain: prose.append(f"  {c['at']:<40} {c.get('how', 'start'):>18}  {c['node']}")
        return {'found': True, 'from': A, 'to': B, 'chains': chains, 'prose': prose, 'more': 0}

    # ── context ──
    def context(self, args):
        task = ' '.join(a for a in args if not os.path.isdir(a))
        low = task.lower()
        rows = []; prose = [f"web: {task}"]
        asks_orphans = re.search(r'\b(unused|orphan|unlinked|dead)\b|\bno page\b|\bnot loaded\b|\bloaded by no\b|\bnobody loads\b', low) and re.search(r'style ?sheets?|\bcss\b|\bsheets?\b', low)
        if asks_orphans:
            for r in self.q("SELECT s.file FROM web_unknown u JOIN web_stylesheets s ON s.uid = u.node_uid WHERE u.kind = 'orphan_sheet' ORDER BY s.file"):
                rows.append(self.row(r['file'], 'stylesheet', 'orphan_sheet', 'unknown', 'orphan_sheet'))
        m = re.search(r'\b(vue|alpine|angular|jinja|handlebars|mustache|erb|django|thymeleaf|liquid|nunjucks|twig|ejs|svelte|htmx)\b', low)
        if m:
            d = m.group(1).upper()
            for r in self.q("""SELECT p.file, count(t.uid) n FROM web_pages p LEFT JOIN web_template_exprs t ON t.page_uid = p.uid AND upper(t.dialect) = ?
                               WHERE upper(COALESCE(p.template_dialects, '')) LIKE ? GROUP BY p.file ORDER BY n DESC, p.file""", d, '%' + d + '%'):
                rows.append(self.row(r['file'], 'page', 'template_pages', expressions=r['n']))
        if re.search(r'\b(theme|colou?rs?|palette|tokens?|design tokens?)\b', low):
            kind = 'color' if re.search(r'colou?r|palette', low) else None
            for r in self.q("SELECT kind, value, uses, project_uses, vars FROM web_tokens WHERE (? IS NULL OR kind = ?) ORDER BY project_uses DESC, uses DESC, value LIMIT 50", kind, kind):
                rows.append(self.row(r['value'], 'token', 'tokens', token_kind=r['kind'], value=r['value'], uses=r['uses'], project_uses=r['project_uses'], vars=r['vars']))
        if re.search(r'\bcomponents?\b|\bsplit\b', low):
            for r in self.q("SELECT display, level, size, occurrences, pages FROM web_components ORDER BY pages * size DESC, occurrences DESC LIMIT 30"):
                rows.append(self.row(f"component:{r['display']}", 'component', 'components', display=r['display'], level=r['level'], size=r['size'], occurrences=r['occurrences'], pages=r['pages']))
        if re.search(r'\b(unused|dead|unmatched)\b', low) and re.search(r'\bcss\b|selectors?|rules?|styles?', low):
            for r in self.q("SELECT file, line, selector_text, unknown_reason FROM web_selectors WHERE usage = 'unmatched_static' ORDER BY file, line LIMIT 200"):
                rows.append(self.row(at_of(r['file'], r['line']), 'selector', 'unmatched', 'unknown', r['unknown_reason'] or 'no_element_matches', selector=r['selector_text']))
        if re.search(r'\bduplicate[d]? ids?\b', low):
            for r in self.q("SELECT e.file, e.line, e.html_id FROM web_elements e JOIN (SELECT page_uid, html_id FROM web_elements WHERE html_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d ON d.page_uid = e.page_uid AND d.html_id = e.html_id ORDER BY e.file, e.line"):
                rows.append(self.row(at_of(r['file'], r['line']), 'element', 'duplicate_id', 'ambiguous', 'duplicate_id', id=r['html_id']))
        # the task's words: class tokens and selectors naming them, ranked by how many rules name them; the sheet holding most first
        words = [w.lower() for w in re.findall(r'[A-Za-z][\w-]{2,}', task) if w.lower() not in STOP]
        responsive = bool(re.search(r'\b(responsive|mobile|breakpoint|media|small screens?|tablet)\b', low))
        hover = bool(re.search(r'\b(hover|focus|active)\b', low))
        scores = {}
        for w in dict.fromkeys(words):
            for r in self.q("""SELECT s.file, s.line, s.selector_text, r.conditions, s.reason FROM web_selector_parts p JOIN web_selectors s ON s.uid = p.selector_uid
                               JOIN web_rules r ON r.uid = s.rule_uid WHERE p.part_kind IN ('CLASS', 'ID') AND (lower(p.name) = ? OR lower(p.name) LIKE ? OR lower(p.name) LIKE ?)""",
                            w, w + '-%', '%-' + w):
                sc = 3 if r['selector_text'].lower().split()[-1].strip('.#').startswith(w) else 2
                if responsive and r['conditions'] and '@media' in r['conditions']: sc += 4
                if hover and r['reason'] and 'state:' in r['reason']: sc += 2
                scores[r['file']] = scores.get(r['file'], 0) + sc
                rows.append(self.row(at_of(r['file'], r['line']), 'selector', 'selectors', selector=r['selector_text'], conditions=r['conditions'], score=sc))
            for r in self.q("SELECT DISTINCT property, file, line FROM web_declarations WHERE is_custom = 1 AND lower(property) LIKE ?", f'%{w}%'):
                scores[r['file']] = scores.get(r['file'], 0) + 1
                rows.append(self.row(at_of(r['file'], r['line']), 'var_def', 'defines', name=r['property'], score=1))
            for r in self.q("SELECT file, count(*) n, min(line) line FROM web_class_tokens WHERE lower(class_name) = ? OR lower(class_name) LIKE ? GROUP BY file", w, w + '-%'):
                scores[r['file']] = scores.get(r['file'], 0) + 0.5 * r['n']
                rows.append(self.row(at_of(r['file'], r['line']), 'element', 'carries', count=r['n'], score=0.5 * r['n']))
            for r in self.q("SELECT file, title FROM web_pages WHERE lower(file) LIKE ? OR lower(COALESCE(title, '')) LIKE ?", f'%{w}%', f'%{w}%'):
                scores[r['file']] = scores.get(r['file'], 0) + 2
                rows.append(self.row(r['file'], 'page', 'pages', title=r['title'], score=2))
        # places, best first: a file's rows ordered by the file's total score
        lead = [r for r in rows if r['role'] in ('orphan_sheet', 'template_pages', 'duplicate_id', 'tokens', 'components', 'unmatched')]
        rest = sorted([r for r in rows if r not in lead], key=lambda r: (-scores.get(r['at'].rsplit(':', 1)[0] if ':' in r['at'] else r['at'], 0), -r.get('score', 0), r['at']))
        rows = lead + rest
        for i, r in enumerate(rows): r['rank'] = i + 1
        if not rows: return {'found': False, 'task': task, 'refusal': "web graph: no class, id, selector, custom property, page or stylesheet matches the task's words", 'rows': [], 'more': 0}
        files = []
        for r in rows:
            f = r['at'].rsplit(':', 1)[0] if re.search(r':\d+$', r['at']) else r['at']
            if f not in files: files.append(f)
        prose.append("web places the task lands on, best first:")
        for f in files[:10]: prose.append(f"  {f}" + (f"  (score {scores[f]:g})" if f in scores else ''))
        for r in rows[:self.limit]:
            prose.append(f"    {r['at']}: {r['kind']} {r.get('selector') or r.get('name') or r.get('reason') or ''}".rstrip())
        prose.append("(impact on any of them: what styles it, what loads it, what it reaches)")
        return {'found': True, 'task': task, 'rows': rows, 'places': files, 'prose': prose, 'more': 0}


def QUOTED(v):
    return f' "{v}"' if v else ''


STOP = {'the', 'and', 'for', 'with', 'where', 'which', 'what', 'how', 'does', 'this', 'that', 'page', 'pages', 'from', 'into', 'are',
        'styled', 'style', 'styles', 'element', 'elements', 'html', 'css', 'class', 'file', 'files', 'when', 'who', 'why', 'used', 'use',
        'make', 'responsive', 'change', 'fix', 'add', 'remove', 'stylesheet', 'stylesheets', 'sheet', 'sheets', 'loads', 'load', 'no', 'not'}


# ── the index (axiomcode-index on a web graph) ───────────────────────────────

INDEX_DDL = '''
DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS refs; DROP TABLE IF EXISTS literals; DROP TABLE IF EXISTS comments; DROP TABLE IF EXISTS nesting;
DROP TABLE IF EXISTS type_refs; DROP TABLE IF EXISTS decorations; DROP TABLE IF EXISTS index_meta; DROP TABLE IF EXISTS paths;
DROP VIEW IF EXISTS callers; DROP VIEW IF EXISTS callees; DROP VIEW IF EXISTS source; DROP VIEW IF EXISTS sites;
CREATE TABLE symbols(id TEXT, name TEXT, display TEXT, kind TEXT, qualified_name TEXT, signature TEXT, file TEXT, line INT, end_line INT, owner TEXT, is_test INT, method_id TEXT, type_id TEXT);
CREATE TABLE refs(name TEXT, file TEXT, line INT, kind TEXT, entity_kind TEXT);
CREATE TABLE literals(value TEXT, file TEXT, line INT, kind TEXT, name TEXT);
CREATE TABLE comments(text TEXT, file TEXT, line INT, kind TEXT);
CREATE TABLE nesting(type_id TEXT, outer_type_id TEXT);
CREATE TABLE type_refs(name TEXT, file TEXT, line INT, context TEXT, owner_kind TEXT);
CREATE TABLE decorations(owner_id TEXT, name TEXT, text TEXT, file TEXT, line INT);
CREATE TABLE index_meta(key TEXT, value TEXT);
CREATE TABLE paths(raw TEXT PRIMARY KEY, rel TEXT);
'''
INDEX_TAIL = '''
CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name); CREATE INDEX IF NOT EXISTS symbols_display ON symbols(display);
CREATE INDEX IF NOT EXISTS symbols_file ON symbols(file, line); CREATE INDEX IF NOT EXISTS symbols_id ON symbols(id);
CREATE INDEX IF NOT EXISTS refs_name ON refs(name); CREATE INDEX IF NOT EXISTS refs_file_line ON refs(file, line);
CREATE VIEW callers AS SELECT e.callee_method_id AS callee_id, e.caller_id, e.call_site_id FROM call_edges e WHERE 0;
CREATE VIEW callees AS SELECT e.caller_id, e.callee_method_id AS callee_id, e.call_site_id FROM call_edges e WHERE 0;
CREATE VIEW source AS SELECT display, qualified_name, name, kind, file, line, end_line, end_line - line + 1 AS lines FROM symbols WHERE method_id IS NOT NULL;
CREATE VIEW sites AS SELECT s.*, s.file_path AS file FROM call_sites s;
'''


def index(db, repo, version):
    """symbols / refs / paths / index_meta for a web graph: every name an agent types resolves to a row"""
    import time
    con = sqlite3.connect(db); c = con.cursor()
    c.executescript(INDEX_DDL)
    S = []
    for r in c.execute("SELECT uid, file, title, end_line FROM web_pages"):
        S.append((r[0], os.path.basename(r[1]), r[1], 'page', r[1], r[2], r[1], 1, r[3], None, 0, None, None))
    for r in c.execute("SELECT uid, file, display, line, end_line, source_kind FROM web_stylesheets"):
        S.append((r[0], os.path.basename(r[1]) if r[5] == 'FILE' else r[2], r[2], 'stylesheet', r[2], None, r[1], r[3] or 1, r[4], None, 0, None, None))
    for r in c.execute("SELECT class_name, min(file), min(line), count(*) FROM web_class_tokens GROUP BY class_name"):
        S.append(('class:' + r[0], r[0], '.' + r[0], 'class', '.' + r[0], f"{r[3]} element(s)", r[1], r[2], r[2], None, 0, None, None))
    for r in c.execute("SELECT sp.name, min(s.file), min(s.line) FROM web_selector_parts sp JOIN web_selectors s ON s.uid = sp.selector_uid WHERE sp.part_kind='CLASS' AND sp.name NOT IN (SELECT class_name FROM web_class_tokens) GROUP BY sp.name"):
        S.append(('class:' + r[0], r[0], '.' + r[0], 'class', '.' + r[0], 'named by a selector only', r[1], r[2], r[2], None, 0, None, None))
    for r in c.execute("SELECT uid, html_id, file, line, end_line, display FROM web_elements WHERE html_id IS NOT NULL"):
        S.append((r[0], r[1], '#' + r[1], 'id', '#' + r[1], r[5], r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT d.def_uid, d.name, COALESCE(dd.file, rr.file), COALESCE(dd.line, rr.line) FROM web_var_def d LEFT JOIN web_declarations dd ON dd.uid = d.def_uid LEFT JOIN web_rules rr ON rr.uid = d.def_uid"):
        S.append((r[0], r[1], r[1], 'css_var', r[1], None, r[2], r[3], r[3], None, 0, None, None))
    for r in c.execute("SELECT uid, name, file, line, end_line, at_rule_name FROM web_rules WHERE at_rule_name LIKE '%keyframes' AND name IS NOT NULL"):
        S.append((r[0], r[1], f"@keyframes {r[1]}", 'keyframes', r[1], r[5], r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT r.uid, trim(d.value_text, ' \"''') fam, r.file, r.line, r.end_line FROM web_rules r JOIN web_declarations d ON d.rule_uid = r.uid WHERE r.at_rule_name = 'font-face' AND lower(d.property) = 'font-family'"):
        S.append((r[0], r[1], f"@font-face {r[1]}", 'font_face', r[1], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT uid, prelude_text, file, line, end_line FROM web_rules WHERE at_rule_name = 'layer' AND prelude_text IS NOT NULL"):
        S.append((r[0], r[1], f"@layer {r[1]}", 'layer', r[1], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT c.name, r.uid, r.file, r.line, r.end_line FROM web_container_use c JOIN web_rules r ON r.uid = c.use_uid"):
        S.append((r[1], r[0], f"@container {r[0]}", 'container', r[0], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT uid, selector_text, file, line, line, rule_uid FROM web_selectors WHERE decidability != 'none'"):
        S.append((r[0], r[1], r[1], 'selector', r[1], None, r[2], r[3], r[4], r[5], 0, None, None))
    for r in c.execute("SELECT uid, file || '#script-' || inline_index, file, line FROM web_scripts WHERE inline_index IS NOT NULL"):
        S.append((r[0], r[1], r[1], 'script', r[1], None, r[2], r[3], r[3], None, 0, None, None))
    for r in c.execute("SELECT uid, display, file, line, end_line FROM web_elements WHERE html_id IS NULL AND class_names IS NOT NULL"):
        S.append((r[0], r[1], r[1], 'element', f"{r[2]}:{r[3]}", None, r[2], r[3], r[4], None, 0, None, None))
    c.executemany("INSERT INTO symbols VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", S)
    refs = []
    refs += list(c.execute("SELECT class_name, file, line, 'class', 'element' FROM web_class_tokens"))
    refs += list(c.execute("SELECT sp.name, s.file, s.line, lower(sp.part_kind), 'selector' FROM web_selector_parts sp JOIN web_selectors s ON s.uid = sp.selector_uid WHERE sp.part_kind IN ('CLASS','ID','TYPE')"))
    refs += list(c.execute("SELECT name, file, line, lower(reference_kind), 'value' FROM web_value_refs WHERE name IS NOT NULL"))
    refs += list(c.execute("SELECT r.id_value, e.file, e.line, 'id', r.attribute_name FROM web_id_refs r JOIN web_elements e ON e.uid = r.from_element_uid"))
    refs += list(c.execute("SELECT callee_name, file, line, 'handler', 'call' FROM web_handler_calls WHERE callee_name IS NOT NULL"))
    c.executemany("INSERT INTO refs VALUES (?,?,?,?,?)", refs)
    c.executemany("INSERT INTO comments VALUES (?,?,?,?)", list(c.execute("SELECT text, file, line, 'css' FROM web_comments")))
    files = {r[0] for t in ('web_pages', 'web_stylesheets') for r in c.execute(f"SELECT DISTINCT file FROM {t} WHERE file IS NOT NULL")}
    c.executemany("INSERT OR IGNORE INTO paths VALUES (?,?)", [(f, f) for f in files])
    c.executescript(INDEX_TAIL)
    n = lambda t: c.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    meta = dict(language='web', repo=repo, built_at=time.strftime('%Y-%m-%dT%H:%M:%S'), index_version=version, ir_present='true',
                symbols=n('symbols'), refs=n('refs'), comments=n('comments'), skipped_files=n('skipped'))
    c.executemany("INSERT INTO index_meta VALUES (?,?)", [(k, str(v)) for k, v in meta.items()])
    con.commit(); con.execute("VACUUM"); con.close()
    print(f"indexed {db} [web]: symbols={meta['symbols']} refs={meta['refs']} comments={meta['comments']}")


if __name__ == '__main__':
    if len(sys.argv) < 2: sys.exit(__doc__)
    v, rest = sys.argv[1], sys.argv[2:]
    repo = repo_of(rest); db = graph_db(repo)
    if language_of(db) != 'web': sys.exit(f"ax_web: {db} is not a web graph")
    sys.exit(Web(db, repo).run(v, rest))
