#!/usr/bin/env python3
"""ax_web.py — the query verbs on a WEB graph (HTML + CSS, `run.language = 'web'`).

A web graph has no call graph: its nodes are pages, elements, class tokens, ids, stylesheets, rules, selectors,
declarations, custom properties, @keyframes, @font-face, @layer, @container and scripts, and its edges are what a page
loads, what links where, which rules style which elements (match / conditional / unknown) and which declarations a
var() reaches (graph/bundle/web/schema.ts). Every verb script hands a web graph to this module first:

  impact <target>      .class  #id  --custom-prop  page.html  css/app.css  page.html:42 (the element there)
                       @keyframes name  @font-face family  @layer name  @container name  a selector as written
                       page.html#script-2 (an inline script)  [--in <page>] [--json]
  path <A> <B>         page -> sheet -> rule -> selector -> element, page -> page by links, --var -> use -> rule -> element
  context "<task>"     the web names the task's words land on (classes, ids, properties, selectors, pages, titles),
                       and the unused stylesheets / template dialect pages when asked for them
  tests                a web graph selects no tests: exit 3, so a repository's other graphs answer alone

Per language: nothing here reads another language's graph. A script's resolved file, an inline script's module
path (`page.html#script-2`) and a handler's callee name are printed as the JavaScript graph's names for them; the
JavaScript graph, asked by the same fan-out (ax_langs.py), answers for its own nodes, including its DOM-touch rows.
"""
import json, os, re, sqlite3, sys
from collections import defaultdict, deque

ROWS = 25


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
    pos = [a for a in args if not a.startswith('-')]
    return pos[-1] if pos and os.path.isdir(pos[-1]) else '.'


def maybe_answer(verb, argv):
    """called first by every verb script: answers and exits when the graph asked is a web graph, else returns"""
    if any(a in ('-h', '--help') for a in argv): return
    repo = repo_of(argv)
    db = graph_db(repo)
    if not os.path.isfile(db) or language_of(db) != 'web': return
    if '--warm' in argv: print("a web graph has no impact facts to precompute"); sys.exit(0)
    sys.exit(Web(db, repo).run(verb, argv))


def split_web(doc):
    """(the document without its web part, [web prose lines]) — for the front door (ax_blocks, ax_grep), which renders a
    call-graph answer as places with code and has nothing to render a web answer with: the web graph's answer is its
    prose, printed after the other languages' places under its own heading. The first item is None when only the web
    graph answered."""
    if not isinstance(doc, dict): return doc, []
    others = dict(doc.get('other_languages') or {})
    web = []
    if doc.get('language') == 'web':
        web.append(doc)
        rest = [(l, o) for l, o in others.items() if l != 'web']
        if not rest: return None, lines_of(web)
        l0, base = rest[0]
        base = dict(base) if isinstance(base, dict) else {'answer': base}
        base['language'] = l0
        if len(rest) > 1: base['other_languages'] = dict(rest[1:])
        return base, lines_of(web)
    if 'web' in others:
        web.append(others.pop('web'))
        doc = dict(doc)
        if others: doc['other_languages'] = others
        else: doc.pop('other_languages', None)
    return doc, lines_of(web)


def lines_of(docs):
    out = []
    for d in docs:
        if not isinstance(d, dict): continue
        p = d.get('prose') or ([d['refusal']] if d.get('refusal') else [])
        if p: out += ['', '══ web graph (HTML + CSS) ══'] + list(p)
    return out


class Web:
    def __init__(self, db, repo):
        self.con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        self.con.row_factory = sqlite3.Row
        self.repo = repo
        self.IN = None

    def q(self, sql, *a):
        return self.con.execute(sql, a).fetchall()

    def q1(self, sql, *a):
        return self.con.execute(sql, a).fetchone()

    # ── dispatch ──
    def run(self, verb, argv):
        args = list(argv); as_json = '--json' in args
        args = [a for a in args if a not in ('--json', '--tests', '--why', '--fresh', '--no-refresh', '--every', '--all')]
        for flag in ('--in', '--limit', '--depth', '--kind', '--budget', '--paths', '--page'):
            if flag in args:
                i = args.index(flag); v = args[i + 1] if i + 1 < len(args) else ''
                del args[i:i + 2]
                if flag == '--in': self.IN = v
        if args and os.path.isdir(args[-1]) and len(args) > (1 if verb != 'path' else 2): args = args[:-1]
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
        rows = self.q("SELECT id FROM web_pages WHERE file = ? OR file LIKE ?", self.IN, '%' + self.IN)
        return {r['id'] for r in rows}

    def classify(self, args):
        """[(kind, value)] for the targets written; an at-rule word joins the name after it"""
        out = []; i = 0
        while i < len(args):
            a = args[i]
            if a in ('@keyframes', '@font-face', '@layer', '@container') and i + 1 < len(args):
                out.append((a[1:], ' '.join(args[i + 1:]) if a == '@font-face' else args[i + 1]))
                i += 2 if a != '@font-face' else len(args) - i; continue
            m = re.match(r'^@(keyframes|font-face|layer|container)[ :](.+)$', a)
            if m: out.append((m.group(1), m.group(2).strip())); i += 1; continue
            out.append(self.kind_of(a)); i += 1
        return out

    def kind_of(self, a):
        if a.startswith('--') and len(a) > 2: return ('var', a)
        m = re.match(r'^(.+\.(?:html?|xhtml))#((?:script|on)-\d+)$', a, re.I)
        if m: return ('script', a)
        m = re.match(r'^(.+\.(?:html?|xhtml|css)):(\d+)$', a, re.I)
        if m: return ('line', (m.group(1), int(m.group(2))))
        if re.match(r'^.+\.(html?|xhtml)$', a, re.I): return ('page', a)
        if re.match(r'^.+\.css$', a, re.I): return ('sheet', a)
        if re.match(r'^\.[A-Za-z_\\-][\w\\:/-]*$', a) and self.q1("SELECT 1 FROM web_class_tokens WHERE class_name=? UNION SELECT 1 FROM web_selector_parts WHERE kind='CLASS' AND name=? LIMIT 1", a[1:], a[1:]):
            return ('class', a[1:])
        if re.match(r'^#[A-Za-z_\-][\w:.-]*$', a) and self.q1("SELECT 1 FROM web_elements WHERE element_id_attr=? UNION SELECT 1 FROM web_selector_parts WHERE kind='ID' AND name=? UNION SELECT 1 FROM web_id_refs WHERE id_value=? LIMIT 1", a[1:], a[1:], a[1:]):
            return ('id', a[1:])
        if self.q1("SELECT 1 FROM web_selectors WHERE text=? LIMIT 1", a): return ('selector', a)
        if a.startswith('.'): return ('class', a[1:])
        if a.startswith('#'): return ('id', a[1:])
        for kind, sql in (('keyframes', "SELECT 1 FROM web_rules WHERE at_rule LIKE '%keyframes' AND name=?"),
                          ('class', "SELECT 1 FROM web_class_tokens WHERE class_name=?"),
                          ('id', "SELECT 1 FROM web_elements WHERE element_id_attr=?"),
                          ('layer', "SELECT 1 FROM web_rules WHERE at_rule='layer' AND (name=? OR prelude=?)"),
                          ('font', "SELECT 1 FROM web_font_use WHERE family=lower(?)")):
            if self.q1(sql + " LIMIT 1", *([a, a] if kind == 'layer' else [a])): return (kind, a)
        return ('selector', a)

    def page_by_file(self, f):
        f = f.replace('\\', '/').lstrip('./')
        return self.q("SELECT * FROM web_pages WHERE file = ? OR file LIKE ? ORDER BY length(file)", f, '%/' + f)

    def sheet_by_file(self, f):
        f = f.replace('\\', '/').lstrip('./')
        return self.q("SELECT * FROM web_stylesheets WHERE source_kind='FILE' AND (file = ? OR file LIKE ?) ORDER BY length(file)", f, '%/' + f)

    def sel_text(self, sid):
        r = self.q1("SELECT text, file, line FROM web_selectors WHERE id=?", sid)
        return r

    # ── impact ──
    def impact(self, args):
        if not args: return {'found': False, 'refusal': 'usage: impact <.class | #id | --prop | page.html | sheet.css | page.html:LINE | @keyframes k | selector>'}
        docs = []
        for kind, val in self.classify(args):
            fn = getattr(self, 'impact_' + {'font-face': 'font'}.get(kind, kind))
            docs.append(fn(val))
        if len(docs) == 1: return docs[0]
        return {'found': any(d.get('found') for d in docs), 'targets': docs, 'prose': [l for d in docs for l in (d.get('prose') or [d.get('refusal', '')]) + ['']]}

    def _places(self, rows, what, tag):
        return [{'file': r['file'], 'line': r['line'], 'what': what(r), 'tag': tag} for r in rows if r['file']]

    def _page_filter(self, col='page_id'):
        sp = self.scope_pages()
        if sp is None: return '', []
        return f" AND {col} IN ({','.join('?' * len(sp))})", list(sp)

    def styles_summary(self, where, params):
        rows = self.q(f"SELECT status, reason, count(*) n FROM web_styles s WHERE {where} GROUP BY status, reason ORDER BY n DESC", *params)
        return [{'status': r['status'], 'reason': r['reason'], 'count': r['n']} for r in rows]

    def impact_class(self, name):
        pf, pp = self._page_filter('t.page_id')
        els = self.q(f"""SELECT t.file, t.line, e.display, e.id, p.file page FROM web_class_tokens t JOIN web_elements e ON e.id = t.element_id
                        JOIN web_pages p ON p.id = t.page_id WHERE t.class_name = ?{pf} ORDER BY t.file, t.line""", name, *pp)
        sels = self.q("""SELECT DISTINCT s.id, s.text, s.file, s.line, s.rule_id, s.sheet_id, s.decidability, s.pages_loading, s.pages_matched, s.elements_matched, st.display sheet
                         FROM web_selector_parts sp JOIN web_selectors s ON s.id = sp.selector_id JOIN web_stylesheets st ON st.id = s.sheet_id
                         WHERE sp.kind='CLASS' AND sp.name = ? ORDER BY s.file, s.line""", name)
        ids = [s['id'] for s in sels]
        styles = []; unknown = []
        if ids:
            ph = ','.join('?' * len(ids))
            styles = self.styles_summary(f"s.selector_id IN ({ph}){pf.replace('t.page_id', 's.page_id')}", ids + pp)
            unknown = [dict(r) for r in self.q(f"SELECT kind, reason, detail, file, line FROM web_unknown WHERE node_id IN ({ph})", *ids)]
            unknown += [dict(r) for r in self.q(f"""SELECT 'styles' kind, s.reason, e.display detail, e.file, e.line FROM web_styles s JOIN web_elements e ON e.id = s.element_id
                                                  WHERE s.selector_id IN ({ph}) AND s.status = 'unknown'{pf.replace('t.page_id', 's.page_id')} LIMIT 200""", *(ids + pp))]
        pages_by_sheet = {}
        for s in sels:
            if s['sheet_id'] not in pages_by_sheet:
                pages_by_sheet[s['sheet_id']] = [r['file'] for r in self.q("SELECT DISTINCT p.file FROM web_loads l JOIN web_pages p ON p.id = l.page_id WHERE l.sheet_id = ? ORDER BY p.file", s['sheet_id'])]
        found = bool(els or sels)
        prose = [f"web: class .{name}"]
        if not found: return {'found': False, 'kind': 'class', 'target': '.' + name, 'refusal': f"web graph: no element carries class '{name}' and no selector names it"}
        prose.append(f"rules naming .{name}: {len(sels)}")
        for s in sels[:ROWS]:
            prose.append(f"  {s['file']}:{s['line']}: {s['text']}   [{s['decidability']}; loaded by {s['pages_loading']} page(s), matches on {s['pages_matched']}]")
        if len(sels) > ROWS: prose.append(f"  … +{len(sels) - ROWS} more")
        by_page = defaultdict(list)
        for e in els: by_page[e['page']].append(e)
        prose.append(f"elements carrying .{name}: {len(els)} on {len(by_page)} page(s)")
        for pg, es in list(by_page.items())[:ROWS]:
            prose.append(f"  {pg}: " + ', '.join(f"{e['line']} {e['display']}" for e in es[:8]) + (f" … +{len(es) - 8}" if len(es) > 8 else ''))
        if styles: prose.append("styles rows through those selectors: " + ', '.join(f"{s['count']} {s['status']}{' (' + s['reason'] + ')' if s['reason'] else ''}" for s in styles[:8]))
        if unknown:
            prose.append(f"unknown (the bound): {len(unknown)}")
            for u in unknown[:10]: prose.append(f"  {u['file']}:{u['line']}: {u['kind']} {u['reason']} {u['detail'] or ''}".rstrip())
        prose.append("(the JavaScript graph lists its DOM-touch sites naming this class in its own section, when the repository has one)")
        return {'found': True, 'kind': 'class', 'target': '.' + name,
                'rules': [dict(s, pages=pages_by_sheet.get(s['sheet_id'], [])) for s in sels],
                'elements': [dict(e) for e in els], 'styles': styles, 'unknown': unknown,
                'places': self._places(sels, lambda r: r['text'], 'rule') + self._places(els, lambda r: r['display'], 'element'), 'prose': prose}

    def impact_id(self, value):
        pf, pp = self._page_filter('e.page_id')
        els = self.q(f"SELECT e.*, p.file page FROM web_elements e JOIN web_pages p ON p.id = e.page_id WHERE e.element_id_attr = ?{pf} ORDER BY e.file, e.line", value, *pp)
        sels = self.q("""SELECT DISTINCT s.id, s.text, s.file, s.line FROM web_selector_parts sp JOIN web_selectors s ON s.id = sp.selector_id
                         WHERE sp.kind='ID' AND sp.name = ? ORDER BY s.file, s.line""", value)
        refs = self.q(f"""SELECT r.kind, r.status, r.reason, f.file, f.line, f.display FROM web_id_refs r JOIN web_elements f ON f.id = r.from_element
                          WHERE r.id_value = ?{pf.replace('e.page_id', 'r.page_id')} ORDER BY f.file, f.line""", value, *pp)
        links = self.q("""SELECT f.file, f.line, f.display, l.url FROM web_links l JOIN web_elements f ON f.id = l.from_element
                          WHERE l.to_element IN (SELECT id FROM web_elements WHERE element_id_attr = ?)""", value)
        if not (els or sels or refs):
            return {'found': False, 'kind': 'id', 'target': '#' + value, 'refusal': f"web graph: no element has id '{value}' and no selector or reference names it"}
        prose = [f"web: id #{value}"]
        by_page = defaultdict(list)
        for e in els: by_page[e['page']].append(e)
        prose.append(f"elements with id {value}: {len(els)}" + (f" — DUPLICATED on {sum(1 for v in by_page.values() if len(v) > 1)} page(s)" if any(len(v) > 1 for v in by_page.values()) else ''))
        for e in els[:ROWS]: prose.append(f"  {e['file']}:{e['line']}: {e['display']}")
        cascade = {}
        for e in els[:10]:
            rows = self.cascade(e['id'])
            cascade[e['id']] = rows
            if rows:
                prose.append(f"  rules styling {e['file']}:{e['line']} in cascade order (last wins):")
                for r in rows[:ROWS]: prose.append("    " + self.cascade_line(r))
        prose.append(f"selectors naming #{value}: {len(sels)}")
        for s in sels[:ROWS]: prose.append(f"  {s['file']}:{s['line']}: {s['text']}")
        if refs:
            prose.append(f"references to #{value} on the same page: {len(refs)}")
            for r in refs[:ROWS]: prose.append(f"  {r['file']}:{r['line']}: {r['display']} [{r['kind']}; {r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if links:
            prose.append(f"links from other pages to #{value}: {len(links)}")
            for r in links[:ROWS]: prose.append(f"  {r['file']}:{r['line']}: {r['display']} → {r['url']}")
        return {'found': True, 'kind': 'id', 'target': '#' + value, 'elements': [dict(e) for e in els], 'selectors': [dict(s) for s in sels],
                'id_refs': [dict(r) for r in refs], 'links': [dict(r) for r in links], 'cascade': cascade,
                'duplicated_on': [p for p, v in by_page.items() if len(v) > 1],
                'places': self._places(els, lambda r: r['display'], 'element') + self._places(refs, lambda r: r['display'], 'reference'), 'prose': prose}

    def cascade(self, element_id):
        return [dict(r) for r in self.q("""SELECT s.status, s.reason, s.conditions, s.pseudo_element, s.spec_a, s.spec_b, s.spec_c, s.layer_rank, s.sheet_order,
                   s.rule_order, s.important_count, sel.text selector, sel.file, sel.line, st.display sheet, s.rule_id
            FROM web_styles s JOIN web_selectors sel ON sel.id = s.selector_id JOIN web_stylesheets st ON st.id = s.sheet_id
            WHERE s.element_id = ?
            ORDER BY s.important_count > 0, s.layer_rank, s.spec_a, s.spec_b, s.spec_c, s.sheet_order, s.rule_order""", element_id)]

    def cascade_line(self, r):
        tag = r['status'] + (f" {r['reason']}" if r['reason'] else '')
        extra = (f" ::{r['pseudo_element']}" if r['pseudo_element'] else '') + (f" under {r['conditions']}" if r['conditions'] else '') + \
                (f" !important×{r['important_count']}" if r['important_count'] else '')
        return f"{r['file']}:{r['line']}: {r['selector']}  ({r['spec_a']},{r['spec_b']},{r['spec_c']}) [{tag}]{extra}"

    def impact_line(self, fl):
        f, n = fl
        if f.lower().endswith('.css'):
            sh = self.sheet_by_file(f)
            if not sh: return {'found': False, 'refusal': f"web graph: no stylesheet {f}"}
            rows = self.q("SELECT id, text FROM web_selectors WHERE sheet_id=? AND line <= ? AND end_line >= ? ORDER BY line DESC", sh[0]['id'], n, n)
            if not rows: return {'found': False, 'refusal': f"web graph: no selector at {f}:{n}"}
            return self.impact_selector(rows[0]['text'], sel_ids=[r['id'] for r in rows])
        pg = self.page_by_file(f)
        if not pg: return {'found': False, 'refusal': f"web graph: no page {f}"}
        els = self.q("SELECT * FROM web_elements WHERE page_id=? AND line=? ORDER BY column", pg[0]['id'], n) or \
              self.q("SELECT * FROM web_elements WHERE page_id=? AND line<=? AND end_line>=? ORDER BY line DESC, column DESC LIMIT 1", pg[0]['id'], n, n)
        if not els: return {'found': False, 'refusal': f"web graph: no element at {f}:{n}"}
        prose = []; out = []
        for e in els:
            rows = self.cascade(e['id'])
            inline = self.q("SELECT property, value, important, line FROM web_declarations WHERE element_id=? ORDER BY position", e['id'])
            prose.append(f"web: element {e['display']} at {e['file']}:{e['line']}")
            prose.append(f"rules styling it in cascade order (last wins): {len(rows)}")
            for r in rows: prose.append("  " + self.cascade_line(r))
            if inline:
                prose.append("inline style (wins over every rule but !important):")
                for d in inline: prose.append(f"  {e['file']}:{d['line']}: {d['property']}: {d['value']}{' !important' if d['important'] else ''}")
            out.append({'element': dict(e), 'cascade': rows, 'inline': [dict(d) for d in inline]})
        return {'found': True, 'kind': 'element', 'target': f"{f}:{n}", 'elements': out,
                'places': [{'file': x['element']['file'], 'line': x['element']['line'], 'what': x['element']['display'], 'tag': 'element'} for x in out], 'prose': prose}

    def impact_selector(self, text, sel_ids=None):
        pf, pp = self._page_filter('s.page_id')
        sels = self.q("SELECT * FROM web_selectors WHERE id IN (%s)" % ','.join('?' * len(sel_ids)), *sel_ids) if sel_ids else \
            self.q("SELECT * FROM web_selectors WHERE text = ? ORDER BY file, line", text)
        if not sels: return {'found': False, 'kind': 'selector', 'target': text, 'refusal': f"web graph: nothing named '{text}' (not a class, id, custom property, page, stylesheet, @-name or selector)"}
        ids = [s['id'] for s in sels]; ph = ','.join('?' * len(ids))
        rows = self.q(f"""SELECT s.status, s.reason, s.conditions, e.file, e.line, e.display, p.file page FROM web_styles s
                          JOIN web_elements e ON e.id = s.element_id JOIN web_pages p ON p.id = s.page_id
                          WHERE s.selector_id IN ({ph}){pf} ORDER BY e.file, e.line""", *(ids + pp))
        prose = [f"web: selector {text}"]
        for s in sels: prose.append(f"  defined at {s['file']}:{s['line']} [{s['decidability']}{'; ' + s['reason'] if s['reason'] else ''}] ({s['spec_a']},{s['spec_b']},{s['spec_c']})")
        prose.append(f"elements it styles: {len(rows)}")
        for r in rows[:ROWS * 2]: prose.append(f"  {r['file']}:{r['line']}: {r['display']} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        un = self.q(f"SELECT reason, detail FROM web_unknown WHERE node_id IN ({ph})", *ids)
        for u in un: prose.append(f"  unmatched: {u['reason']}")
        return {'found': True, 'kind': 'selector', 'target': text, 'selectors': [dict(s) for s in sels], 'styles': [dict(r) for r in rows],
                'unmatched': [dict(u) for u in un], 'places': self._places(rows, lambda r: r['display'], 'styled'), 'prose': prose}

    def impact_var(self, name):
        defs = self.q("""SELECT d.id, d.file, d.line, d.value, d.rule_id, d.element_id, sel.text selector FROM web_declarations d
                         LEFT JOIN web_selectors sel ON sel.rule_id = d.rule_id AND sel.position = 0
                         WHERE d.property = ? AND d.custom = 1 ORDER BY d.file, d.line""", name)
        uses = self.q("""SELECT d.id, d.file, d.line, d.property, d.value, d.rule_id FROM web_uses_var u JOIN web_declarations d ON d.id = u.declaration_id
                         WHERE u.name = ? ORDER BY d.file, d.line""", name)
        if not (defs or uses): return {'found': False, 'kind': 'var', 'target': name, 'refusal': f"web graph: no declaration defines or uses {name}"}
        # transitively: custom properties defined with var(name)
        seen = {name}; frontier = [name]; chain = []
        while frontier:
            n = frontier.pop()
            for r in self.q("SELECT DISTINCT d.property FROM web_uses_var u JOIN web_declarations d ON d.id = u.declaration_id WHERE u.name = ? AND d.custom = 1", n):
                if r['property'] not in seen: seen.add(r['property']); frontier.append(r['property']); chain.append((n, r['property']))
        all_uses = self.q(f"""SELECT DISTINCT d.id, d.file, d.line, d.property, d.value, d.rule_id, u.name FROM web_uses_var u JOIN web_declarations d ON d.id = u.declaration_id
                              WHERE u.name IN ({','.join('?' * len(seen))}) ORDER BY d.file, d.line""", *seen)
        rule_ids = list({u['rule_id'] for u in all_uses if u['rule_id']})
        pf, pp = self._page_filter('s.page_id')
        styled = []
        if rule_ids:
            styled = self.q(f"""SELECT DISTINCT e.file, e.line, e.display, s.status, p.file page FROM web_styles s JOIN web_elements e ON e.id = s.element_id
                               JOIN web_pages p ON p.id = s.page_id WHERE s.rule_id IN ({','.join('?' * len(rule_ids))}){pf} ORDER BY e.file, e.line""", *(rule_ids + pp))
        inline_els = self.q("SELECT DISTINCT e.file, e.line, e.display FROM web_declarations d JOIN web_elements e ON e.id = d.element_id WHERE d.id IN (%s)" % ','.join('?' * len(all_uses)), *[u['id'] for u in all_uses]) if all_uses else []
        unknown = self.q("SELECT page_id, status, reason, count(*) n FROM web_var WHERE name = ? AND status != 'match' GROUP BY page_id, status, reason", name)
        prose = [f"web: custom property {name}", f"defined: {len(defs)}"]
        for d in defs[:ROWS]:
            where = d['selector'] or 'style=""'
            prose.append(f"  {d['file']}:{d['line']}: {where} {{ {name}: {d['value']} }}")
        prose.append(f"used (directly): {len(uses)}")
        for u in uses[:ROWS]: prose.append(f"  {u['file']}:{u['line']}: {u['property']}: {u['value']}")
        if chain: prose.append("custom properties defined through it: " + ', '.join(b for a, b in chain))
        prose.append(f"elements styled by those uses: {len(styled) + len(inline_els)}")
        for s in styled[:ROWS]: prose.append(f"  {s['file']}:{s['line']}: {s['display']} [{s['status']}]")
        for s in inline_els[:ROWS]: prose.append(f"  {s['file']}:{s['line']}: {s['display']} [inline style]")
        if unknown: prose.append(f"uses not satisfied on some page: {sum(u['n'] for u in unknown)} (" + ', '.join(sorted({u['reason'] or u['status'] for u in unknown})) + ")")
        return {'found': True, 'kind': 'var', 'target': name, 'definitions': [dict(d) for d in defs], 'uses': [dict(u) for u in all_uses],
                'derived': [b for a, b in chain], 'styled_elements': [dict(s) for s in styled] + [dict(s) for s in inline_els],
                'unknown': [dict(u) for u in unknown],
                'places': self._places(defs, lambda r: name, 'defines') + self._places(all_uses, lambda r: r['property'], 'uses'), 'prose': prose}

    def impact_sheet(self, f):
        sh = self.sheet_by_file(f)
        if not sh: return {'found': False, 'kind': 'stylesheet', 'target': f, 'refusal': f"web graph: no stylesheet {f} (a file the walk did not read is listed by `impact` on the page that links it, as not_indexed)"}
        s = sh[0]
        loads = self.q("""SELECT p.file, l.via, l.sheet_order, l.import_depth, l.status, l.media FROM web_loads l JOIN web_pages p ON p.id = l.page_id
                          WHERE l.sheet_id = ? ORDER BY p.file""", s['id'])
        imports = self.q("SELECT i.status, i.reason, i.url, t.file FROM web_imports i LEFT JOIN web_stylesheets t ON t.id = i.to_sheet WHERE i.from_sheet = ?", s['id'])
        imported_by = self.q("SELECT f.file FROM web_imports i JOIN web_stylesheets f ON f.id = i.from_sheet WHERE i.to_sheet = ?", s['id'])
        nrules = self.q1("SELECT count(*) n FROM web_rules WHERE sheet_id = ?", s['id'])['n']
        nsel = self.q1("SELECT count(*) n FROM web_selectors WHERE sheet_id = ?", s['id'])['n']
        per_page = self.q("""SELECT p.file, count(DISTINCT s.element_id) n FROM web_styles s JOIN web_pages p ON p.id = s.page_id
                             WHERE s.sheet_id = ? AND s.status != 'unknown' GROUP BY p.file ORDER BY p.file""", s['id'])
        unmatched = self.q("""SELECT sel.text, sel.line, u.reason FROM web_unknown u JOIN web_selectors sel ON sel.id = u.node_id
                              WHERE u.kind='selector_unmatched' AND sel.sheet_id = ? ORDER BY sel.line""", s['id'])
        urls = self.q("SELECT name, resolved_file, line FROM web_value_refs WHERE sheet_id = ? AND kind='URL' ORDER BY line", s['id'])
        gaps = self.q("SELECT kind, detail, line FROM web_gaps WHERE owner_id = ? ORDER BY line", s['id'])
        prose = [f"web: stylesheet {s['file']} ({nrules} rules, {nsel} selectors{', vendor' if s['vendor'] else ''}{', minified' if s['minified'] else ''})"]
        prose.append(f"pages that load it: {len({l['file'] for l in loads})}" + ('' if loads else ' — an orphan sheet: no <link> and no @import chain reaches it'))
        for l in loads[:ROWS]: prose.append(f"  {l['file']}  [{l['via']}{', import depth ' + str(l['import_depth']) if l['import_depth'] else ''}; order {l['sheet_order']}{'; media ' + l['media'] if l['media'] else ''}]")
        if imported_by: prose.append("imported by: " + ', '.join(r['file'] for r in imported_by))
        if imports:
            prose.append("imports:")
            for i in imports: prose.append(f"  {i['file'] or i['url']}  [{i['status']}{' ' + i['reason'] if i['reason'] else ''}]")
        if per_page:
            prose.append("elements it styles, per page:")
            for p in per_page[:ROWS]: prose.append(f"  {p['file']}: {p['n']}")
        if unmatched:
            prose.append(f"selectors that match nothing on any page loading it: {len(unmatched)}")
            for u in unmatched[:ROWS]: prose.append(f"  {s['file']}:{u['line']}: {u['text']}  [{u['reason']}]")
        if urls:
            prose.append(f"url() references: {len(urls)}")
            for u in urls[:ROWS]: prose.append(f"  {s['file']}:{u['line']}: {u['name']} → {u['resolved_file'] or 'unresolved'}")
        if gaps:
            prose.append(f"parse gaps: {len(gaps)}")
            for g in gaps[:10]: prose.append(f"  {s['file']}:{g['line']}: {g['kind']} {g['detail'] or ''}")
        return {'found': True, 'kind': 'stylesheet', 'target': s['file'], 'loaded_by': [dict(l) for l in loads], 'imports': [dict(i) for i in imports],
                'imported_by': [r['file'] for r in imported_by], 'rules': nrules, 'selectors': nsel, 'styled_per_page': [dict(p) for p in per_page],
                'unmatched': [dict(u) for u in unmatched], 'urls': [dict(u) for u in urls], 'gaps': [dict(g) for g in gaps],
                'places': [{'file': s['file'], 'line': 1, 'what': s['file'], 'tag': 'stylesheet'}], 'prose': prose}

    def impact_page(self, f):
        pg = self.page_by_file(f)
        if not pg: return {'found': False, 'kind': 'page', 'target': f, 'refusal': f"web graph: no page {f}"}
        p = pg[0]; pid = p['id']
        linked_from = self.q("""SELECT e.file, e.line, e.display, l.kind FROM web_links l JOIN web_elements e ON e.id = l.from_element
                                WHERE l.to_page = ? ORDER BY e.file, e.line""", pid)
        loads = self.q("""SELECT l.via, l.sheet_order, l.import_depth, l.status, l.reason, l.url, l.media, l.disabled, s.display FROM web_loads l
                          LEFT JOIN web_stylesheets s ON s.id = l.sheet_id WHERE l.page_id = ? ORDER BY l.sheet_order IS NULL, l.sheet_order""", pid)
        scripts = self.q("SELECT script_kind, script_type, src, resolved_file, js_module_path, line FROM web_scripts WHERE page_id = ? ORDER BY line", pid)
        handlers = self.q("""SELECT h.event, h.callee_name, h.callee_text, h.js_module_path, h.line, h.source, e.display FROM web_handler_calls h
                             LEFT JOIN web_elements e ON e.id = h.element_id WHERE h.page_id = ? ORDER BY h.line, h.column""", pid)
        tpl = self.q("SELECT dialect, directive, expression_text, callee_names, line FROM web_template_exprs WHERE page_id = ? ORDER BY line", pid)
        inline = self.q("""SELECT e.line, e.display, group_concat(d.property, ', ') props FROM web_declarations d JOIN web_elements e ON e.id = d.element_id
                           WHERE d.page_id = ? AND d.attribute_id IS NOT NULL GROUP BY e.id ORDER BY e.line""", pid)
        links_out = self.q("""SELECT e.line, e.display, l.kind, l.status, l.reason, l.url, t.file FROM web_links l JOIN web_elements e ON e.id = l.from_element
                              LEFT JOIN web_pages t ON t.id = l.to_page WHERE l.page_id = ? ORDER BY e.line""", pid)
        forms = self.q("""SELECT e.id, e.line, e.display, r.url FROM web_elements e LEFT JOIN web_references r ON r.element_id = e.id AND r.kind = 'FORM_ACTION'
                          WHERE e.page_id = ? AND lower(e.tag) = 'form' ORDER BY e.line""", pid)
        resources = self.q("""SELECT r.kind, r.url, r.file, r.status, r.reason FROM web_resources r WHERE r.owner_id = ? ORDER BY r.kind, r.url""", pid)
        unknown = self.q("SELECT kind, reason, detail, line FROM web_unknown WHERE page_id = ? AND kind != 'parse_gap' ORDER BY line", pid)
        inert = self.q1("SELECT count(*) n FROM web_elements WHERE page_id = ? AND inert = 1", pid)['n']
        prose = [f"web: page {p['file']}" + (f" — \"{p['title']}\"" if p['title'] else '') + (f" [{p['document_kind']}]" if p['document_kind'] != 'DOCUMENT' else '')]
        prose.append(f"pages linking to it: {len(linked_from)}")
        for r in linked_from[:ROWS]: prose.append(f"  {r['file']}:{r['line']}: {r['display']} [{r['kind'].lower()}]")
        prose.append(f"stylesheets it loads, in cascade order: {len(loads)}")
        for l in loads:
            if l['status'] == 'unknown': prose.append(f"  ?  {l['url']}  [unknown {l['reason']}]")
            else: prose.append(f"  {l['sheet_order']}. {l['display']}  [{l['via']}{', import depth ' + str(l['import_depth']) if l['import_depth'] else ''}{', media ' + l['media'] if l['media'] else ''}{', disabled' if l['disabled'] else ''}]")
        prose.append(f"scripts: {len(scripts)}")
        for s in scripts:
            prose.append(f"  {p['file']}:{s['line']}: {s['script_kind'].lower()} {s['script_type'].lower()}" + (f" src={s['src']}" if s['src'] else '') +
                         (f" → JS module {s['js_module_path']}" if s['js_module_path'] else (' (unresolved)' if s['src'] else '')))
        if handlers:
            prose.append(f"inline event handlers: {len(handlers)}")
            for h in handlers[:ROWS * 2]: prose.append(f"  {p['file']}:{h['line']}: {h['display'] or ''} on{h['event'] or ''} → {h['callee_text'] or h['callee_name']}" + (f"  [JS module {h['js_module_path']}]" if h['js_module_path'] else ''))
        if tpl:
            prose.append(f"template expressions: {len(tpl)} ({', '.join(sorted({t['dialect'] for t in tpl}))})")
            for t in tpl[:ROWS]: prose.append(f"  {p['file']}:{t['line']}: {t['directive'] or '{{ }}'} = {t['expression_text']}" + (f"  calls {t['callee_names']}" if t['callee_names'] else ''))
        if inline:
            prose.append(f"elements with inline style: {len(inline)}")
            for i in inline[:ROWS]: prose.append(f"  {p['file']}:{i['line']}: {i['display']} {{ {i['props']} }}")
        if forms:
            prose.append(f"forms: {len(forms)}")
            for fm in forms:
                names = self.q("""SELECT DISTINCT a.value FROM web_attributes a JOIN web_elements e ON e.id = a.element_id
                                  WHERE a.page_id = ? AND a.name = 'name' AND lower(e.tag) IN ('input','select','textarea','button')
                                  AND e.line >= ? ORDER BY e.line""", pid, fm['line'])
                prose.append(f"  {p['file']}:{fm['line']}: {fm['display']} action={fm['url'] or '(this page)'}  inputs: {', '.join(n['value'] for n in names if n['value'])}")
        if links_out:
            prose.append(f"links out: {len(links_out)}")
            for l in links_out[:ROWS]: prose.append(f"  {p['file']}:{l['line']}: {l['display']} → {l['file'] or l['url']} [{l['status']}{' ' + l['reason'] if l['reason'] else ''}]")
        if resources:
            prose.append(f"resources: {len(resources)}")
            for r in resources[:ROWS]: prose.append(f"  {r['kind'].lower()} {r['url']} → {r['file'] or '-'} [{r['status']}{' ' + r['reason'] if r['reason'] else ''}]")
        if inert: prose.append(f"elements inside <template>/<noscript> (inert): {inert}")
        if unknown:
            prose.append(f"unknown: {len(unknown)}")
            for u in unknown[:ROWS]: prose.append(f"  {p['file']}:{u['line']}: {u['kind']} {u['reason']} {u['detail'] or ''}".rstrip())
        inl = [s['js_module_path'] for s in scripts if s['script_kind'] == 'INLINE' and s['js_module_path']]
        if inl: prose.append("(the JavaScript graph answers for the functions in " + ', '.join(inl) + ")")
        return {'found': True, 'kind': 'page', 'target': p['file'], 'page': dict(p), 'linked_from': [dict(r) for r in linked_from], 'loads': [dict(l) for l in loads],
                'scripts': [dict(s) for s in scripts], 'handlers': [dict(h) for h in handlers], 'template_exprs': [dict(t) for t in tpl],
                'inline_styles': [dict(i) for i in inline], 'links_out': [dict(l) for l in links_out], 'forms': [dict(f_) for f_ in forms],
                'resources': [dict(r) for r in resources], 'unknown': [dict(u) for u in unknown], 'inert_elements': inert,
                'places': [{'file': p['file'], 'line': 1, 'what': p['file'], 'tag': 'page'}] + self._places(linked_from, lambda r: r['display'], 'links here'), 'prose': prose}

    def impact_script(self, a):
        page, _, frag = a.partition('#')
        rows = self.q("SELECT * FROM web_scripts WHERE js_module_path = ?", a) or \
            self.q("SELECT h.*, h.js_module_path FROM web_handler_calls h WHERE h.js_module_path = ?", a)
        if not rows: return {'found': False, 'kind': 'script', 'target': a, 'refusal': f"web graph: no inline script {a}"}
        r = rows[0]
        prose = [f"web: {a} — {page}:{r['line']}", "(its functions are the JavaScript graph's: that graph answers in its own section)"]
        return {'found': True, 'kind': 'script', 'target': a, 'script': dict(r), 'places': [{'file': page, 'line': r['line'], 'what': a, 'tag': 'script'}], 'prose': prose}

    def impact_keyframes(self, name):
        defs = self.q("SELECT file, line, at_rule, id FROM web_rules WHERE at_rule LIKE '%keyframes' AND name = ? ORDER BY file, line", name)
        uses = self.q("""SELECT v.file, v.line, d.property, d.value, d.rule_id, k.status FROM web_keyframes_use k JOIN web_value_refs v ON v.id = k.value_ref_id
                         LEFT JOIN web_declarations d ON d.id = v.declaration_id WHERE k.name = ? ORDER BY v.file, v.line""", name)
        if not (defs or uses): return {'found': False, 'kind': 'keyframes', 'target': name, 'refusal': f"web graph: no @keyframes {name} and no animation names it"}
        rule_ids = list({u['rule_id'] for u in uses if u['rule_id']})
        styled = self.q(f"""SELECT DISTINCT e.file, e.line, e.display, s.status FROM web_styles s JOIN web_elements e ON e.id = s.element_id
                           WHERE s.rule_id IN ({','.join('?' * len(rule_ids))}) ORDER BY e.file, e.line""", *rule_ids) if rule_ids else []
        prose = [f"web: @keyframes {name}", f"defined: {len(defs)}"]
        for d in defs: prose.append(f"  {d['file']}:{d['line']}: @{d['at_rule']} {name}")
        prose.append(f"animations naming it: {len(uses)}")
        for u in uses[:ROWS]: prose.append(f"  {u['file']}:{u['line']}: {u['property']}: {u['value']}" + ('' if u['status'] == 'match' else f"  [{u['status']}]"))
        prose.append(f"elements those rules animate: {len(styled)}")
        for s in styled[:ROWS]: prose.append(f"  {s['file']}:{s['line']}: {s['display']} [{s['status']}]")
        return {'found': True, 'kind': 'keyframes', 'target': name, 'definitions': [dict(d) for d in defs], 'uses': [dict(u) for u in uses], 'styled_elements': [dict(s) for s in styled],
                'places': self._places(defs, lambda r: '@keyframes ' + name, 'defines') + self._places(uses, lambda r: r['property'] or '', 'uses'), 'prose': prose}

    def impact_font(self, family):
        fam = family.strip().strip('"\'').lower()
        faces = self.q("""SELECT DISTINCT r.file, r.line, r.id FROM web_rules r JOIN web_declarations d ON d.rule_id = r.id
                          WHERE r.at_rule = 'font-face' AND lower(d.property) = 'font-family' AND lower(trim(d.value, ' "''')) = ?""", fam)
        uses = self.q("""SELECT v.file, v.line, d.property, d.value, f.status, f.reason FROM web_font_use f JOIN web_value_refs v ON v.id = f.value_ref_id
                         LEFT JOIN web_declarations d ON d.id = v.declaration_id WHERE f.family = ? ORDER BY v.file, v.line""", fam)
        if not (faces or uses): return {'found': False, 'kind': 'font_face', 'target': family, 'refusal': f"web graph: no @font-face declares '{family}' and no font-family names it"}
        prose = [f"web: @font-face {family}", f"declared by: {len(faces)}"]
        for f in faces: prose.append(f"  {f['file']}:{f['line']}: @font-face")
        prose.append(f"used by: {len(uses)}")
        for u in uses[:ROWS]: prose.append(f"  {u['file']}:{u['line']}: {u['property']}: {u['value']}" + ('' if u['status'] == 'match' else f"  [{u['status']} {u['reason']}]"))
        return {'found': True, 'kind': 'font_face', 'target': family, 'faces': [dict(f) for f in faces], 'uses': [dict(u) for u in uses],
                'places': self._places(faces, lambda r: '@font-face', 'declares') + self._places(uses, lambda r: r['property'] or '', 'uses'), 'prose': prose}

    def impact_layer(self, name):
        rows = self.q("SELECT file, line, prelude, name, id FROM web_rules WHERE at_rule = 'layer' AND (name = ? OR prelude = ? OR (',' || replace(prelude, ' ', '') || ',') LIKE ?) ORDER BY file, line",
                      name, name, '%,' + name + ',%')
        inside = self.q1("SELECT count(*) n FROM web_rules WHERE layer = ? OR layer LIKE ?", name, name + '.%')['n']
        if not rows: return {'found': False, 'kind': 'layer', 'target': name, 'refusal': f"web graph: no @layer {name}"}
        order = self.q("SELECT DISTINCT layer FROM web_rules WHERE layer IS NOT NULL ORDER BY layer")
        prose = [f"web: @layer {name}", f"declared at: {len(rows)}"] + [f"  {r['file']}:{r['line']}: @layer {r['prelude'] or r['name']}" for r in rows]
        prose.append(f"rules inside it: {inside}")
        return {'found': True, 'kind': 'layer', 'target': name, 'declarations': [dict(r) for r in rows], 'rules_inside': inside,
                'layers': [r['layer'] for r in order], 'places': self._places(rows, lambda r: '@layer', 'declares'), 'prose': prose}

    def impact_container(self, name):
        rows = self.q("""SELECT c.status, c.reason, r.file, r.line, r.prelude, d.file dfile, d.line dline FROM web_container_use c JOIN web_rules r ON r.id = c.rule_id
                         LEFT JOIN web_declarations d ON d.id = c.declaration_id WHERE c.name = ?""", name)
        if not rows: return {'found': False, 'kind': 'container', 'target': name, 'refusal': f"web graph: no @container {name}"}
        prose = [f"web: @container {name}"] + [f"  {r['file']}:{r['line']}: @container {r['prelude']} → {(r['dfile'] + ':' + str(r['dline'])) if r['dfile'] else r['reason']}" for r in rows]
        return {'found': True, 'kind': 'container', 'target': name, 'uses': [dict(r) for r in rows], 'places': self._places(rows, lambda r: '@container', 'query'), 'prose': prose}

    # ── path ──
    def endpoint(self, a):
        """the node set an endpoint names"""
        kind, v = self.kind_of(a)
        if kind == 'page': return [('page', r['id']) for r in self.page_by_file(v)]
        if kind == 'sheet': return [('sheet', r['id']) for r in self.sheet_by_file(v)]
        if kind == 'class': return [('el', r['element_id']) for r in self.q("SELECT element_id FROM web_class_tokens WHERE class_name = ?", v)] + \
                [('sel', r['selector_id']) for r in self.q("SELECT DISTINCT selector_id FROM web_selector_parts WHERE kind='CLASS' AND name = ?", v)]
        if kind == 'id': return [('el', r['id']) for r in self.q("SELECT id FROM web_elements WHERE element_id_attr = ?", v)]
        if kind == 'var': return [('var', v)]
        if kind == 'line':
            f, n = v; pg = self.page_by_file(f)
            if pg: return [('el', r['id']) for r in self.q("SELECT id FROM web_elements WHERE page_id = ? AND line = ?", pg[0]['id'], n)]
            return []
        if kind in ('keyframes',): return [('rule', r['id']) for r in self.q("SELECT id FROM web_rules WHERE at_rule LIKE '%keyframes' AND name = ?", v)]
        if kind == 'selector': return [('sel', r['id']) for r in self.q("SELECT id FROM web_selectors WHERE text = ?", v)]
        return []

    def neighbours(self, node):
        k, v = node; q = self.q
        if k == 'page':
            for r in q("SELECT sheet_id, via FROM web_loads WHERE page_id = ? AND sheet_id IS NOT NULL", v): yield ('sheet', r['sheet_id']), f"loads ({r['via']})"
            for r in q("SELECT to_page FROM web_links WHERE page_id = ? AND to_page IS NOT NULL", v): yield ('page', r['to_page']), 'links to'
            for r in q("SELECT id FROM web_elements WHERE page_id = ?", v): yield ('el', r['id']), 'contains'
        elif k == 'sheet':
            for r in q("SELECT to_sheet FROM web_imports WHERE from_sheet = ? AND to_sheet IS NOT NULL", v): yield ('sheet', r['to_sheet']), '@import'
            for r in q("SELECT id FROM web_rules WHERE sheet_id = ? AND rule_kind = 'STYLE_RULE'", v): yield ('rule', r['id']), 'contains rule'
        elif k == 'rule':
            for r in q("SELECT id FROM web_selectors WHERE rule_id = ?", v): yield ('sel', r['id']), 'selector'
        elif k == 'sel':
            for r in q("SELECT DISTINCT element_id, status FROM web_styles WHERE selector_id = ? AND element_id IS NOT NULL AND status != 'unknown'", v): yield ('el', r['element_id']), f"styles [{r['status']}]"
        elif k == 'var':
            for r in q("SELECT declaration_id FROM web_defines_var WHERE name = ?", v): yield ('def', r['declaration_id']), 'defined by'
        elif k == 'def':
            name = q("SELECT name FROM web_defines_var WHERE declaration_id = ?", v)
            for n in name:
                for r in q("SELECT declaration_id FROM web_uses_var WHERE name = ?", n['name']): yield ('use', r['declaration_id']), 'used by'
        elif k == 'use':
            for r in q("SELECT rule_id, element_id FROM web_declarations WHERE id = ?", v):
                if r['rule_id']: yield ('rule', r['rule_id']), 'in rule'
                if r['element_id']: yield ('el', r['element_id']), 'inline style of'
            p = q("SELECT property FROM web_declarations WHERE id = ? AND custom = 1", v)
            for r in p: yield ('var', r['property']), 'defines'
        elif k == 'el':
            for r in q("SELECT to_page FROM web_links WHERE from_element = ? AND to_page IS NOT NULL", v): yield ('page', r['to_page']), 'links to'
            for r in q("SELECT to_element FROM web_id_refs WHERE from_element = ? AND to_element IS NOT NULL", v): yield ('el', r['to_element']), 'refers to'

    def label(self, node):
        k, v = node
        if k == 'page': r = self.q1("SELECT file FROM web_pages WHERE id = ?", v); return (r['file'], 1, r['file']) if r else (None, None, v)
        if k == 'sheet': r = self.q1("SELECT display, file, start_line FROM web_stylesheets WHERE id = ?", v); return (r['file'], r['start_line'] or 1, r['display']) if r else (None, None, v)
        if k == 'rule':
            r = self.q1("SELECT r.file, r.line, group_concat(s.text, ', ') t FROM web_rules r LEFT JOIN web_selectors s ON s.rule_id = r.id WHERE r.id = ?", v)
            return (r['file'], r['line'], f"rule {r['t'] or ''}") if r else (None, None, v)
        if k == 'sel': r = self.q1("SELECT file, line, text FROM web_selectors WHERE id = ?", v); return (r['file'], r['line'], r['text']) if r else (None, None, v)
        if k == 'el': r = self.q1("SELECT file, line, display FROM web_elements WHERE id = ?", v); return (r['file'], r['line'], r['display']) if r else (None, None, v)
        if k in ('def', 'use'):
            r = self.q1("SELECT file, line, property, value FROM web_declarations WHERE id = ?", v); return (r['file'], r['line'], f"{r['property']}: {r['value']}") if r else (None, None, v)
        if k == 'var': return (None, None, v)
        return (None, None, v)

    def path(self, args):
        pos = [a for a in args if not os.path.isdir(a)] if len(args) > 2 else args
        if len(pos) < 2: return {'found': False, 'refusal': 'usage: path <A> <B>  (page.html, sheet.css, .class, #id, --prop, page.html:LINE, selector)'}
        A, B = pos[0], pos[1]
        src, dst = self.endpoint(A), set(self.endpoint(B))
        if not src: return {'found': False, 'refusal': f"web graph: nothing named '{A}'"}
        if not dst: return {'found': False, 'refusal': f"web graph: nothing named '{B}'"}
        scope = self.scope_pages()
        prev = {s: None for s in src}; dq = deque(src); hits = []
        while dq and len(hits) < 5 and len(prev) < 200000:
            n = dq.popleft()
            if n in dst and n not in src: hits.append(n); continue
            for m, how in self.neighbours(n):
                if m in prev: continue
                if scope and m[0] == 'page' and m[1] not in scope and m not in dst: continue
                prev[m] = (n, how); dq.append(m)
        for s in src:
            if s in dst: hits.insert(0, s)
        if not hits: return {'found': False, 'from': A, 'to': B, 'refusal': f"web graph: no chain from {A} to {B} (loads, @import, rules, selectors, styles, links, var() and id references followed)"}
        chains = []; prose = [f"web: {A} → {B}"]
        for h in hits:
            hops = []; n = h
            while prev.get(n):
                p, how = prev[n]; hops.append((p, how, n)); n = p
            hops.reverse()
            chain = []
            if not hops:
                f, l, t = self.label(h); chain.append({'file': f, 'line': l, 'node': t, 'how': 'is'})
            for i, (p, how, n2) in enumerate(hops):
                if i == 0:
                    f, l, t = self.label(p); chain.append({'file': f, 'line': l, 'node': t, 'how': 'start'})
                f, l, t = self.label(n2); chain.append({'file': f, 'line': l, 'node': t, 'how': how})
            chains.append(chain)
            prose.append(f"chain ({len(chain) - 1} hop(s)):")
            for c in chain: prose.append(f"  {(c['file'] + ':' + str(c['line'])) if c['file'] else '':<40} {c['how']:>18}  {c['node']}")
        return {'found': True, 'from': A, 'to': B, 'chains': chains, 'prose': prose}

    # ── context ──
    def context(self, args):
        task = ' '.join(a for a in args if not os.path.isdir(a))
        low = task.lower()
        prose = [f"web: {task}"]; doc = {'found': False, 'task': task}
        if re.search(r'\b(unused|orphan|unlinked|not loaded|dead)\b.*\b(style ?sheets?|css)\b|\b(style ?sheets?|css)\b.*\b(unused|orphan|not loaded|loaded by no)\b', low):
            rows = self.q("SELECT file, line FROM web_unknown WHERE kind = 'orphan_sheet' ORDER BY file")
            prose.append(f"stylesheets loaded by no page: {len(rows)}"); prose += [f"  {r['file']}" for r in rows]
            doc.update(found=True, orphan_sheets=[r['file'] for r in rows])
        m = re.search(r'\b(vue|alpine|angular|jinja|handlebars|mustache|erb|django|thymeleaf|liquid|nunjucks|twig|ejs|svelte|htmx)\b', low)
        if m:
            d = m.group(1).upper()
            rows = self.q("""SELECT p.file, count(t.id) n FROM web_pages p LEFT JOIN web_template_exprs t ON t.page_id = p.id AND upper(t.dialect) = ?
                             WHERE upper(p.template_dialects) LIKE ? GROUP BY p.file ORDER BY p.file""", d, '%' + d + '%')
            prose.append(f"pages using {m.group(1)} templates: {len(rows)}"); prose += [f"  {r['file']}  ({r['n']} expression(s))" for r in rows]
            doc.update(found=True, template_pages=[dict(r) for r in rows])
        if re.search(r'\bduplicate[d]? ids?\b', low):
            rows = self.q("SELECT file, line, detail FROM web_unknown WHERE kind = 'duplicate_id' ORDER BY file, line")
            prose.append(f"duplicated ids: {len(rows)}"); prose += [f"  {r['file']}:{r['line']}: {r['detail']}" for r in rows]
            doc.update(found=True, duplicate_ids=[dict(r) for r in rows])
        words = [w for w in re.findall(r'[#.]?-{0,2}[A-Za-z_][\w-]{2,}', task) if w.lower() not in STOP]
        hits = []
        for w in dict.fromkeys(words):
            bare = w.lstrip('.#')
            for kind, sql, args_ in (
                ('class', "SELECT DISTINCT class_name n, file, line FROM web_class_tokens WHERE class_name = ? OR class_name LIKE ? LIMIT 8", (bare, f'%{bare}%')),
                ('id', "SELECT DISTINCT element_id_attr n, file, line FROM web_elements WHERE element_id_attr = ? OR element_id_attr LIKE ? LIMIT 8", (bare, f'%{bare}%')),
                ('selector', "SELECT text n, file, line FROM web_selectors WHERE text LIKE ? LIMIT 8", (f'%{bare}%',)),
                ('custom property', "SELECT DISTINCT property n, file, line FROM web_declarations WHERE custom = 1 AND property LIKE ? LIMIT 8", (f'%{bare}%',)),
                ('keyframes', "SELECT name n, file, line FROM web_rules WHERE at_rule LIKE '%keyframes' AND name LIKE ? LIMIT 8", (f'%{bare}%',)),
                ('page', "SELECT file n, file, 1 line FROM web_pages WHERE file LIKE ? OR title LIKE ? LIMIT 8", (f'%{bare}%', f'%{bare}%')),
                ('stylesheet', "SELECT file n, file, 1 line FROM web_stylesheets WHERE source_kind='FILE' AND file LIKE ? LIMIT 8", (f'%{bare}%',))):
                for r in self.q(sql, *args_):
                    hits.append({'word': w, 'kind': kind, 'name': r['n'], 'file': r['file'], 'line': r['line']})
        if hits:
            doc['found'] = True
            prose.append(f"web names the task's words land on: {len(hits)}")
            seen = set()
            for h in hits:
                k = (h['kind'], h['name'], h['file'])
                if k in seen: continue
                seen.add(k)
                prose.append(f"  {h['file']}:{h['line']}: {h['kind']} {h['name']}")
                if len(seen) >= 40: break
            prose.append("(impact on any of them for what styles it, what loads it and what it reaches)")
        doc['hits'] = hits; doc['prose'] = prose
        if not doc['found']: doc['refusal'] = f"web graph: no class, id, selector, custom property, page or stylesheet matches the task's words"
        return doc


STOP = {'the', 'and', 'for', 'with', 'where', 'which', 'what', 'how', 'does', 'this', 'that', 'page', 'pages', 'from', 'into', 'are', 'is',
        'styled', 'style', 'styles', 'element', 'elements', 'html', 'css', 'class', 'file', 'files', 'when', 'who', 'why', 'used', 'use'}


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
    """symbols / refs / paths / skipped / index_meta for a web graph: every name an agent types resolves to a row"""
    import time
    con = sqlite3.connect(db); c = con.cursor()
    c.executescript(INDEX_DDL)
    S = []
    for r in c.execute("SELECT id, file, title, end_line FROM web_pages"):
        S.append((r[0], os.path.basename(r[1]), r[1], 'page', r[1], r[2], r[1], 1, r[3], None, 0, None, None))
    for r in c.execute("SELECT id, file, display, start_line, end_line, source_kind FROM web_stylesheets"):
        S.append((r[0], os.path.basename(r[1]) if r[5] == 'FILE' else r[2], r[2], 'stylesheet', r[2], None, r[1], r[3] or 1, r[4], None, 0, None, None))
    for r in c.execute("SELECT class_name, min(file), min(line), count(*) FROM web_class_tokens GROUP BY class_name"):
        S.append(('class:' + r[0], r[0], '.' + r[0], 'class', '.' + r[0], f"{r[3]} element(s)", r[1], r[2], r[2], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT sp.name, s.file, s.line FROM web_selector_parts sp JOIN web_selectors s ON s.id = sp.selector_id WHERE sp.kind='CLASS' AND sp.name NOT IN (SELECT class_name FROM web_class_tokens) GROUP BY sp.name"):
        S.append(('class:' + r[0], r[0], '.' + r[0], 'class', '.' + r[0], 'named by a selector only', r[1], r[2], r[2], None, 0, None, None))
    for r in c.execute("SELECT id, element_id_attr, file, line, end_line, display FROM web_elements WHERE element_id_attr IS NOT NULL"):
        S.append((r[0], r[1], '#' + r[1], 'id', '#' + r[1], r[5], r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT d.property, d.file, d.line, d.end_line FROM web_declarations d WHERE d.custom = 1"):
        S.append(('css_var:' + r[0], r[0], r[0], 'css_var', r[0], None, r[1], r[2], r[3], None, 0, None, None))
    for r in c.execute("SELECT id, name, file, line, end_line, at_rule FROM web_rules WHERE at_rule LIKE '%keyframes' AND name IS NOT NULL"):
        S.append((r[0], r[1], f"@keyframes {r[1]}", 'keyframes', r[1], r[5], r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT f.family, rr.id, rr.file, rr.line, rr.end_line FROM web_font_use f JOIN web_rules rr ON rr.id = f.rule_id"):
        S.append((r[1], r[0], f"@font-face {r[0]}", 'font_face', r[0], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT id, coalesce(nullif(name, ''), prelude), file, line, end_line FROM web_rules WHERE at_rule = 'layer'"):
        S.append((r[0], r[1], f"@layer {r[1]}", 'layer', r[1], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT DISTINCT c.name, r.id, r.file, r.line, r.end_line FROM web_container_use c JOIN web_rules r ON r.id = c.rule_id"):
        S.append((r[1], r[0], f"@container {r[0]}", 'container', r[0], None, r[2], r[3], r[4], None, 0, None, None))
    for r in c.execute("SELECT id, text, file, line, end_line, rule_id FROM web_selectors"):
        S.append((r[0], r[1], r[1], 'selector', r[1], None, r[2], r[3], r[4], r[5], 0, None, None))
    for r in c.execute("SELECT id, js_module_path, file, line FROM web_scripts WHERE js_module_path LIKE '%#script-%'"):
        S.append((r[0], r[1], r[1], 'script', r[1], None, r[2], r[3], r[3], None, 0, None, None))
    for r in c.execute("SELECT id, display, file, line, end_line FROM web_elements WHERE element_id_attr IS NULL AND class_names IS NOT NULL"):
        S.append((r[0], r[1], r[1], 'element', f"{r[2]}:{r[3]}", None, r[2], r[3], r[4], None, 0, None, None))
    c.executemany("INSERT INTO symbols VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", S)
    refs = []
    refs += list(c.execute("SELECT class_name, file, line, 'class', 'element' FROM web_class_tokens"))
    refs += list(c.execute("SELECT sp.name, s.file, s.line, lower(sp.kind), 'selector' FROM web_selector_parts sp JOIN web_selectors s ON s.id = sp.selector_id WHERE sp.kind IN ('CLASS','ID','TYPE')"))
    refs += list(c.execute("SELECT name, file, line, lower(kind), 'value' FROM web_value_refs WHERE name IS NOT NULL"))
    refs += list(c.execute("SELECT id_value, p.file, e.line, 'id', kind FROM web_id_refs r JOIN web_pages p ON p.id = r.page_id JOIN web_elements e ON e.id = r.from_element"))
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
