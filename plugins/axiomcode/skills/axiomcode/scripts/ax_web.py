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

Per language: nothing here reads another language's graph. A script's resolved file, an inline script's module path
(`page.html#script-2`) and a handler's callee name are printed as the JavaScript graph's names for them; the
JavaScript graph, asked by the same fan-out (ax_langs.py), answers for its own nodes, including its DOM-touch rows.
"""
import json, os, re, sqlite3, sys
from collections import deque

ROWS = 25
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
    if lang == 'javascript' and verb == 'impact' and not os.environ.get('AXIOMCODE_WEBJS_INNER'):
        r = js_page_answer(db, repo, argv)
        if r is not None: sys.exit(r)
        return
    if lang != 'web': return
    if '--warm' in argv: print("a web graph has no impact facts to precompute"); sys.exit(0)
    sys.exit(Web(db, repo).run(verb, argv))


# ── the JavaScript graph's own answer about markup (per language: its rows, never a web node) ───────────────────

def js_page_answer(db, repo, argv):
    """impact on a JavaScript graph for what names markup: a page (the functions of its inline scripts and on*
    bodies, and its DOM touches), a .class / #id (the DOM touches naming that token), a .js file (its usual answer plus
    the DOM touches it makes). None when the target is none of these: the verb answers as always."""
    args = [a for a in argv if not a.startswith('-')]
    as_json = '--json' in argv
    targets = [a for a in args if not os.path.isdir(a)]
    if len(targets) != 1: return None
    t = targets[0]
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True); con.row_factory = sqlite3.Row
    have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    if 'ext_dom_touch' not in have: return None
    rows = []; prose = []
    def touches(where, *a):
        out = []
        for r in con.execute(f"SELECT file, line, api, arg_index, literal, literal_kind, tokens, status FROM ext_dom_touch WHERE {where} ORDER BY file, line", a):
            out.append({'at': at_of(r['file'], r['line']), 'kind': 'dom_touch', 'role': 'dom_touch', 'status': 'match' if r['status'] == 'literal' else 'unknown',
                        'reason': None if r['status'] == 'literal' else 'non_literal', 'api': r['api'], 'arg_index': r['arg_index'], 'literal': r['literal'],
                        'literal_kind': r['literal_kind'], 'tokens': r['tokens']})
        return out
    if re.match(r'^[^\s]+\.(html?|xhtml)$', t, re.I):
        page = t[2:] if t.startswith('./') else t
        names = {r[0]: r[1] for r in con.execute("SELECT method_id, name FROM ext_method_name")} if 'ext_method_name' in have else {}
        for m in con.execute("SELECT id, name, qualified_name, file_path, start_line, kind FROM methods WHERE file_path = ? AND kind != 'MODULE_INITIALIZER' ORDER BY start_line", (page,)):
            qn = m['qualified_name'] or ''
            mod = next((qn[:qn.index(k)] + k + re.match(r'\d+', qn[qn.index(k) + len(k):]).group(0) for k in ('#script-', '#on-') if k in qn and re.match(r'\d+', qn[qn.index(k) + len(k):])), None)
            nm = names.get(m['id'], m['name'])
            rows.append({'at': at_of(m['file_path'], m['start_line']), 'kind': 'function', 'role': 'inline_script', 'status': 'match', 'reason': None,
                         'name': None if (nm or '').startswith('<') else nm, 'module': mod, 'qualified_name': qn})
        rows += touches("file = ?", page)
        if not rows: return None
        prose.append(f"javascript: {page}")
        prose.append(f"functions in its inline scripts and on* bodies: {sum(1 for r in rows if r['role'] == 'inline_script')}")
        for r in rows:
            if r['role'] == 'inline_script': prose.append(f"  {r['at']}: {r['name'] or '(anonymous)'}  [{r['module']}]")
    elif re.match(r'^[.#][^\s.#\[:>+~]+$', t):
        tok = t
        rows += touches("(',' || tokens || ',') LIKE ?", f'%,{tok},%')
        if not rows: return None
        prose.append(f"javascript: DOM touches naming {tok}")
    elif re.match(r'^[^\s]+\.(m?js|cjs|jsx)$', t, re.I):
        f = t[2:] if t.startswith('./') else t
        tt = touches("file = ? OR file LIKE ?", f, '%/' + f)
        if not tt: return None
        # the verb's own answer, with the DOM touches beside it
        import subprocess
        env = dict(os.environ, AXIOMCODE_WEBJS_INNER='1')
        argv2 = list(argv) if as_json else list(argv) + ['--json']
        r = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'axiomcode-impact')] + argv2, env=env, capture_output=True, text=True)
        try: doc = json.loads(r.stdout)
        except ValueError: doc = {}
        if not isinstance(doc, dict): doc = {'answer': doc}
        doc['dom_touch'] = tt
        if as_json: print(json.dumps(doc, indent=1, default=str))
        else:
            sys.stdout.write(subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'axiomcode-impact')] + list(argv), env=env, capture_output=True, text=True).stdout)
            print(f"\nDOM touches in {f}: {len(tt)}")
            for x in tt[:ROWS]: print(f"  {x['at']}: {x['api']} {x['literal'] if x['literal'] is not None else '(not a literal)'}")
        return 0
    else:
        return None
    for r in rows:
        if r['role'] == 'dom_touch': prose.append(f"  {r['at']}: {r['api']} {r['literal'] if r['literal'] is not None else '(not a literal)'}")
    doc = {'found': True, 'language': 'javascript', 'target': t, 'rows': rows, 'prose': prose, 'more': 0}
    if as_json: print(json.dumps(doc, indent=1, default=str))
    else: print('\n'.join(prose))
    return 0


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

    def q(self, sql, *a):
        return self.con.execute(sql, a).fetchall()

    def q1(self, sql, *a):
        return self.con.execute(sql, a).fetchone()

    # ── dispatch ──
    def run(self, verb, argv):
        args = list(argv); as_json = '--json' in args
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

    def in_page(self, col):
        sp = self.scope_pages()
        if sp is None: return '', []
        return f" AND {col} IN ({','.join('?' * len(sp)) or 'NULL'})", list(sp)

    def classify(self, args):
        """[(kind, value)] for the targets written; an at-rule word joins the name after it"""
        out = []; i = 0
        while i < len(args):
            a = args[i]
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
        if re.match(r'^.+\.(?:html?|xhtml)#(?:script|on)-\d+$', a, re.I): return ('script', a)
        m = re.match(r'^(.+\.(?:html?|xhtml|css)):(\d+)$', a, re.I)
        if m: return ('line', (m.group(1), int(m.group(2))))
        if re.match(r'^[^\s]+\.(html?|xhtml)$', a, re.I): return ('page', a)
        if re.match(r'^[^\s]+\.css$', a, re.I): return ('sheet', a)
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
                   s.rule_order, s.important_count, sel.selector_text, sel.file, sel.line, st.display sheet, s.scope_root
            FROM web_styles s JOIN web_selectors sel ON sel.uid = s.selector_uid JOIN web_stylesheets st ON st.uid = s.stylesheet_uid
            WHERE s.element_uid = ? AND s.status != 'unknown'
            ORDER BY s.important_count > 0, s.layer_rank, s.spec_a, s.spec_b, s.spec_c, s.sheet_order, s.rule_order""", element_uid)
        out = []
        for i, r in enumerate(rows):
            out.append(self.row(at_of(r['file'], r['line']), 'styles', role, r['status'], r['reason'], rank=i + 1, selector=r['selector_text'],
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
        els = self.q(f"""SELECT t.file, t.line, e.display, e.inert, e.uid FROM web_class_tokens t JOIN web_elements e ON e.uid = t.element_uid
                        WHERE t.class_name = ? AND (e.inert IS NULL OR e.inert != 'iframe_text'){pf} ORDER BY t.file, t.line""", name, *pp)
        sels = self.q("""SELECT DISTINCT s.uid, s.selector_text, s.file, s.line, s.decidability, s.reason, s.pages_loading, s.pages_matched
                         FROM web_selector_parts sp JOIN web_selectors s ON s.uid = sp.selector_uid
                         WHERE sp.part_kind = 'CLASS' AND sp.name = ? ORDER BY s.file, s.line""", name)
        if not (els or sels): return {'found': False, 'kind': 'class', 'target': '.' + name, 'refusal': f"web graph: no element carries class '{name}' and no selector names it"}
        rows = [self.row(at_of(e['file'], e['line']), 'element', 'carries', 'conditional' if e['inert'] else 'match', f"inert:{e['inert']}" if e['inert'] else None, display=e['display']) for e in els]
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
        prose = [f"web: class .{name}"]
        self.section(prose, f"elements carrying .{name}", [r for r in rows if r['role'] == 'carries'], lambda r: f"{r['at']}: {r['display']}" + (f" [{r['reason']}]" if r['reason'] else ''))
        self.section(prose, f"selectors naming .{name}", [r for r in rows if r['role'] == 'selectors'],
                     lambda r: f"{r['at']}: {r['selector']}  [loaded by {r['pages_loading']} page(s), matches on {r['pages_matched']}]")
        if unknown: self.section(prose, "unknown (the bound)", unknown, lambda r: f"{r['at']}: {r['reason']}" + (f" {r.get('display', '')}" if r.get('display') else ''))
        prose.append("(the JavaScript graph lists its DOM-touch sites naming this class in its own section)")
        return self.finish({'found': True, 'kind': 'class', 'target': '.' + name, 'prose': prose}, rows)

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
        prose = [f"web: id #{value}"]
        self.section(prose, f"elements with id {value}", [r for r in rows if r['role'] == 'carries'], lambda r: f"{r['at']}: {r['display']}" + (' [duplicated on this page]' if r['reason'] else ''))
        self.section(prose, "rules styling them, in cascade order (last wins)", [r for r in rows if r['role'] == 'styled_by'], self.cascade_line)
        self.section(prose, f"selectors naming #{value}", [r for r in rows if r['role'] == 'selectors'], lambda r: f"{r['at']}: {r['selector']}")
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
            prose.append(f"web: element {e['display']} at {e['file']}:{e['line']}" + (f" (inert: {e['inert']})" if e['inert'] else ''))
            self.section(prose, "rules styling it in cascade order (last wins)", cas, self.cascade_line)
            if inline: self.section(prose, "inline style (wins over every rule but !important)", inline,
                                    lambda d: f"{e['file']}:{d['line']}: {d['property']}: {d['value_text']}{' !important' if d['is_important'] else ''}")
        return self.finish({'found': True, 'kind': 'element', 'target': f"{f}:{n}", 'prose': prose}, rows)

    def impact_selector(self, text, sel_ids=None):
        pf, pp = self.in_page('s.page_uid')
        sels = self.q("SELECT * FROM web_selectors WHERE uid IN (%s)" % ','.join('?' * len(sel_ids)), *sel_ids) if sel_ids else \
            self.q("SELECT * FROM web_selectors WHERE selector_text = ? ORDER BY file, line", text)
        if not sels: return {'found': False, 'kind': 'selector', 'target': text, 'refusal': f"web graph: nothing named '{text}' (not a class, id, custom property, page, stylesheet, @-name or selector)"}
        ids = [s['uid'] for s in sels]; ph = ','.join('?' * len(ids))
        styled = self.q(f"""SELECT DISTINCT s.status, s.reason, e.file, e.line, e.display FROM web_styles s JOIN web_elements e ON e.uid = s.element_uid
                            WHERE s.selector_uid IN ({ph}){pf} ORDER BY e.file, e.line""", *(ids + pp))
        rows = [self.row(at_of(s['file'], s['line']), 'selector', 'selectors', 'match' if s['decidability'] == 'exact' else 'conditional' if s['decidability'] == 'conditional' else 'unknown',
                         s['reason'], selector=s['selector_text'], specificity=f"{s['spec_a']},{s['spec_b']},{s['spec_c']}") for s in sels]
        rows += [self.row(at_of(r['file'], r['line']), 'element', 'styled', r['status'], r['reason'], display=r['display']) for r in styled]
        pf2, pp2 = self.in_page('page_uid')
        rows += [self.row(None, 'selector', 'unknown', 'unknown', u['reason']) for u in self.q(f"SELECT DISTINCT reason FROM web_unknown WHERE node_uid IN ({ph}){pf2}", *(ids + pp2))]
        prose = [f"web: selector {text}"]
        self.section(prose, "defined at", [r for r in rows if r['role'] == 'selectors'], lambda r: f"{r['at']}: {r['selector']} ({r['specificity']}) [{r['status']}]")
        self.section(prose, "elements it styles", [r for r in rows if r['role'] == 'styled'], lambda r: f"{r['at']}: {r['display']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
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
        unresolved = self.q("SELECT reason, count(*) n FROM web_var_visible WHERE name = ? AND def_uid IS NULL GROUP BY reason", name)
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
        unmatched = self.q("""SELECT sel.selector_text, sel.line, sel.file FROM web_selectors sel
                              WHERE sel.stylesheet_uid = ? AND sel.pages_loading > 0 AND sel.pages_matched = 0 AND sel.decidability != 'none'
                                AND NOT EXISTS (SELECT 1 FROM web_styles st WHERE st.selector_uid = sel.uid)
                                AND NOT EXISTS (SELECT 1 FROM web_unknown u WHERE u.node_uid = sel.uid AND u.reason != 'no_static_carrier')
                              ORDER BY sel.line""", sid)
        urls = self.q("""SELECT v.name, v.resolved_file, v.line, v.file FROM web_value_refs v
                         WHERE v.stylesheet_uid = ? AND v.reference_kind = 'URL' ORDER BY v.line""", sid)
        gaps = self.q("SELECT kind, detail, line FROM web_gaps WHERE owner_uid = ? ORDER BY line", sid)
        seen_pages = {}
        for l in loads: seen_pages.setdefault(l['file'], l)
        rows = [self.row(p, 'page', 'loaded_by', l['status'], l['reason'], via=l['via'], import_depth=l['import_depth'], load_order=l['load_order']) for p, l in seen_pages.items()]
        rows += [self.row(i['file'] or i['url_as_written'], 'stylesheet', 'imports', i['status'], i['reason']) for i in imports]
        rows += [self.row(r['file'], 'stylesheet', 'imported_by') for r in imported_by]
        rows += [self.row(at_of(u['file'], u['line']), 'selector', 'unmatched', 'unknown', 'no_element_matches', selector=u['selector_text']) for u in unmatched]
        rows += [self.row(u['resolved_file'] or u['name'], 'file', 'uses_resource', 'match' if u['resolved_file'] else 'unknown', None if u['resolved_file'] else 'unresolved_url',
                          url=u['name'], line=u['line']) for u in urls if not (u['name'] or '').startswith('data:')]
        rows += [self.row(at_of(s['file'], g['line']), 'gap', 'gaps', 'unknown', g['kind'], detail=g['detail']) for g in gaps]
        prose = [f"web: stylesheet {s['file']} ({nrules} rules{', vendor' if s['vendor'] else ''}{', minified' if s['minified'] else ''})"]
        self.section(prose, "pages that load it" + ('' if loads else ' — none: an orphan sheet'), [r for r in rows if r['role'] == 'loaded_by'],
                     lambda r: f"{r['at']}  [{r['via']}{', import depth ' + str(r['import_depth']) if r.get('import_depth') else ''}{'; ' + r['status'] + ' ' + (r['reason'] or '') if r['status'] != 'match' else ''}]")
        if imported_by: prose.append("imported by: " + ', '.join(r['file'] for r in imported_by))
        if imports: self.section(prose, "imports", [r for r in rows if r['role'] == 'imports'], lambda r: f"{r['at']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if per_page:
            prose.append("elements it styles, per page:")
            for p in per_page[:self.limit]: prose.append(f"  {p['file']}: {p['n']}")
        self.section(prose, "selectors that match nothing on any page loading it", [r for r in rows if r['role'] == 'unmatched'], lambda r: f"{r['at']}: {r['selector']}")
        if urls: self.section(prose, "url() references", [r for r in rows if r['role'] == 'uses_resource'], lambda r: f"{s['file']}:{r.get('line')}: {r['url']} → {r['at'] if r['status'] == 'match' else 'unresolved'}")
        if gaps: self.section(prose, "parse gaps", [r for r in rows if r['role'] == 'gaps'], lambda r: f"{r['at']}: {r['reason']} {r.get('detail') or ''}")
        return self.finish({'found': True, 'kind': 'stylesheet', 'target': s['file'], 'prose': prose}, rows)

    def impact_page(self, f):
        pg = self.page_by_file(f)
        if not pg: return {'found': False, 'kind': 'page', 'target': f, 'refusal': f"web graph: no page {f}"}
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
                rows.append(self.row(l['file'] if l['source_kind'] == 'FILE' else l['display'], 'stylesheet', 'loads', l['status'], l['reason'], rank=l['load_order'], via=l['via'],
                                     import_depth=l['import_depth'], media=l['media'], display=l['display']))
        for s in self.q("""SELECT s.script_kind, s.script_type, s.src, s.resolved_file, s.js_module_path, s.line, r.url_kind FROM web_scripts s
                           LEFT JOIN web_references r ON r.element_uid = s.element_uid AND r.attribute_name = 'src' WHERE s.page_uid = ? ORDER BY s.line""", pid):
            if s['script_kind'] == 'EXTERNAL' and not s['resolved_file']:
                reason = 'external_url' if s['url_kind'] in ('ABSOLUTE', 'PROTOCOL_RELATIVE', 'OTHER_SCHEME') else 'template_url' if s['url_kind'] == 'TEMPLATE_EXPRESSION' else 'unresolved_url'
                rows.append(self.row(at_of(pf, s['line']), 'script', 'unknown', 'unknown', reason, url=s['src']))
            rows.append(self.row(at_of(pf, s['line']), 'script', 'scripts', script_kind=s['script_kind'], script_type=s['script_type'], src=s['src'], js_module_path=s['js_module_path']))
        for h in self.q("""SELECT h.event, h.callee_name, h.callee_text, h.js_module_path, h.handler_source, e.file, e.line, e.display FROM web_handler_calls h
                           LEFT JOIN web_elements e ON e.uid = h.element_uid WHERE h.page_uid = ? ORDER BY e.line, h.line, h.col""", pid):
            role = 'handler' if h['handler_source'] in ('EVENT_ATTRIBUTE', 'JAVASCRIPT_URL') else 'template_expr'
            rows.append(self.row(at_of(h['file'], h['line']), 'handler_call', role, calleeName=h['callee_name'], callee_text=h['callee_text'], event=h['event'],
                                 source=h['handler_source'], js_module_path=h['js_module_path'], display=h['display']))
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
        prose = [f"web: page {pf}" + (f" — \"{p['title']}\"" if p['title'] else '') + (f" [{p['document_kind']}]" if p['document_kind'] != 'DOCUMENT' else '')]
        R = lambda role: [r for r in rows if r['role'] == role]
        self.section(prose, "pages linking to it", R('linked_from'), lambda r: f"{r['at']}: {r['display']} [{r['attribute']}]")
        self.section(prose, "stylesheets it loads, in cascade order", R('loads'), lambda r: f"{r['rank']}. {r['display']}  [{r['via']}{', import depth ' + str(r['import_depth']) if r.get('import_depth') else ''}{', ' + r['media'] if r.get('media') else ''}{', ' + r['reason'] if r['reason'] else ''}]")
        self.section(prose, "scripts", R('scripts'), lambda r: f"{r['at']}: {r['script_kind'].lower()} {r['script_type'].lower()}" + (f" src={r['src']}" if r.get('src') else '') + (f" → JS module {r['js_module_path']}" if r.get('js_module_path') else ''))
        if R('handler'): self.section(prose, "inline event handlers", R('handler'), lambda r: f"{r['at']}: {r.get('display') or ''} on{r.get('event') or ''} → {r.get('callee_text') or r.get('calleeName')}" + (f"  [JS module {r['js_module_path']}]" if r.get('js_module_path') else ''))
        if R('template_expr'): self.section(prose, "template directives and the names they call", R('template_expr'), lambda r: f"{r['at']}: {r.get('directive') or r.get('source') or ''} → {r.get('calleeName')}")
        if tpl: prose.append(f"template expressions: {len(tpl)} ({', '.join(sorted({t['dialect'] for t in tpl}))})")
        if R('inline_style'): self.section(prose, "inline styles", R('inline_style'), lambda r: f"{r['at']}: {r['display']} {{ {r['property']}: {r.get('value')} }}")
        if R('form'): self.section(prose, "forms", R('form'), lambda r: f"{r['at']}: {r['display']} action={r['action']}  inputs: {', '.join(r['names'])}")
        if R('links_to'): self.section(prose, "links out", R('links_to'), lambda r: f"{r['at']}: {r['display']} → {r['to']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if R('uses_resource'): self.section(prose, "link resources (icon, preload, manifest)", R('uses_resource'), lambda r: f"{r['url']} → {r['at']} [{r['status']}]")
        if R('inert'): self.section(prose, "inert elements (inside <template>/<noscript>/<iframe> text)", R('inert'), lambda r: f"{r['at']}: {r['display']} [{r['reason']}]")
        if R('unknown'): self.section(prose, "unknown (what the page names that lands nowhere)", R('unknown'), lambda r: f"{r['at']}: {r['reason']}" + (f" {r['url']}" if r.get('url') else ''))
        inl = [r['js_module_path'] for r in R('scripts') if r.get('script_kind') == 'INLINE' and r.get('js_module_path')]
        if inl: prose.append("(the JavaScript graph answers for the functions in " + ', '.join(inl) + ")")
        return self.finish({'found': True, 'kind': 'page', 'target': pf, 'prose': prose}, rows)

    def impact_script(self, a):
        page = a.partition('#')[0]
        r = self.q1("SELECT line FROM web_scripts WHERE js_module_path = ?", a) or self.q1("SELECT line FROM web_handler_calls WHERE js_module_path = ?", a)
        if not r: return {'found': False, 'kind': 'script', 'target': a, 'refusal': f"web graph: no inline script {a}"}
        rows = [self.row(at_of(page, r['line']), 'script', 'script', js_module_path=a)]
        return self.finish({'found': True, 'kind': 'script', 'target': a, 'prose': [f"web: {a} — {page}:{r['line']}", "(its functions are the JavaScript graph's: that graph answers in its own section)"]}, rows)

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
        lead = [r for r in rows if r['role'] in ('orphan_sheet', 'template_pages', 'duplicate_id')]
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
    for r in c.execute("SELECT uid, js_module_path, file, line FROM web_scripts WHERE js_module_path LIKE '%#script-%'"):
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
