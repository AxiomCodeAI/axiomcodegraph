#!/usr/bin/env python3
"""Normalize the engine's web graph (and the JavaScript graph's per-language additions) into the
oracle's row vocabulary, so a case compares as a sorted multiset diff.

  normalize.py <out-dir> [--kinds=a,b,...]     prints rows on stdout, sorted

<out-dir> is what `bin/axiomcode <src> <out-dir>` writes: <out-dir>/web/graph.sqlite and, for the
js suite, <out-dir>/javascript/graph.sqlite.

THE CONTRACT (the engine's tables this reads; SPEC.md section 5.1 in concrete column names).
Every web node table has `uid` (the parser's unique hash), `file` (repo-relative), `line`, `col`
(1-based start of the node in the file on disk). NULL is written as '-'.

  web_pages(uid, file, document_kind)
  web_elements(uid, page_uid, parent_uid, file, line, col, tag_name, html_id, class_names)    class_names space-separated as written
  web_attributes(uid, element_uid, name, value)
  web_class_tokens(uid, element_uid, position, class_name)
  web_references(uid, element_uid, attribute_name, url_as_written, url_kind, resolved_file)    url_kind = parser WebUrlKind
  web_scripts(uid, element_uid, script_kind, script_type, resolved_file, js_module_path)
  web_handler_calls(uid, element_uid, attribute_uid, handler_source, callee_name, js_module_path)
  web_template_exprs(uid, element_uid, attribute_uid, expression_text)                         attribute_uid NULL = element text
  web_stylesheets(uid, file, source_kind, owner_element_uid)                                    source_kind FILE | HTML_STYLE_ELEMENT
  web_rules(uid, stylesheet_uid, parent_uid, file, line, col, rule_kind, at_rule_name, prelude_text)
  web_selectors(uid, rule_uid, position, selector_text, spec_a, spec_b, spec_c)
  web_selector_parts(uid, selector_uid, part_kind, name)
  web_declarations(uid, rule_uid, attribute_uid, file, line, col, property, value_text, is_important)
  web_value_refs(uid, declaration_uid, rule_uid, reference_kind, name, fallback_text, url_kind, resolved_file)
  web_comments(uid, file, line, col)
  web_loads(page_uid, stylesheet_uid, url_as_written, via, load_order, import_depth, status, reason)
  web_imports(from_stylesheet_uid, to_stylesheet_uid, url_as_written, status, reason)
  web_links(from_element_uid, attribute_name, to_page_uid, to_element_uid, url_as_written, status, reason)
  web_id_refs(from_element_uid, attribute_name, id_value, to_element_uid, status, reason)
  web_styles(selector_uid, element_uid, page_uid, status, reason, pseudo_element, conditions,
             spec_a, spec_b, spec_c, layer_rank, sheet_order, rule_order, important_count)
             reason: every reason, sorted, ';'-joined ('state:hover;at_rule:media' -> 'at_rule:media;state:hover')
  web_var(use_uid, name, def_uid, page_uid, status, reason)              use_uid = the using declaration
  web_keyframes_use(use_uid, name, target_uid, page_uid, status, reason)  use_uid = declaration
  web_font_use(use_uid, name, target_uid, page_uid, status, reason)
  web_container_use(use_uid, name, target_uid, page_uid, status, reason)  use_uid = the @container rule
  web_unknown(kind, node_uid, page_uid, reason, detail)                  orphan_sheet, fragment_no_host,
             no_static_carrier, shadow_dom, selector_unparsed, implied_element, column_combinator, lang_unknown
  JavaScript graph (per-language, never joined to the web graph):
  methods(name, qualified_name, file_path, start_line, kind)   MODULE_INITIALIZER rows skipped; an inline module's functions carry
             qualified_name starting with '<page>#script-<n>' / '<page>#on-<n>'
  ext_dom_touch(file, line, api, arg_index, literal, tokens, status)

Row keys (identical to the oracle's): page = file; element = file:line:col; sheet = file for a FILE
sheet, style@<element key> for a <style>; rule = file:line:col; selector = <rule key>/<position>;
declaration = file:line:col; value_ref owner = its declaration key or (at-rule refs) its rule key.
"""
import os
import sqlite3
import sys

URL_KIND = {'RELATIVE': 'local', 'ROOT_RELATIVE': 'local', 'ABSOLUTE': 'external', 'PROTOCOL_RELATIVE': 'external',
            'FRAGMENT': 'fragment', 'DATA_URI': 'data', 'JAVASCRIPT_URI': 'scheme', 'OTHER_SCHEME': 'scheme',
            'TEMPLATE_EXPRESSION': 'template', 'EMPTY': 'empty'}
SOURCE = {'HTML_STYLE_ELEMENT': 'STYLE', 'FILE': 'FILE'}


def esc(v):
    if v is None or v == '':
        return '-'
    s = str(v)
    if isinstance(v, float) and v.is_integer():
        s = str(int(v))
    return s.replace('\\', '\\\\').replace('\t', '\\t').replace('\r', '\\r').replace('\n', '\\n')


def die(msg):
    print(f'normalize: {msg}', file=sys.stderr)
    sys.exit(3)


class Graph:
    def __init__(self, path):
        if not os.path.isfile(path):
            die(f'no graph at {path}')
        self.db = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
        self.tables = {r[0] for r in self.db.execute("select name from sqlite_master where type in ('table','view')")}

    def rows(self, table, cols):
        if table not in self.tables:
            die(f'table {table} missing from the web graph (contract: graph/test/web/tools/normalize.py)')
        have = {r[1] for r in self.db.execute(f'pragma table_info({table})')}
        missing = [c for c in cols if c not in have]
        if missing:
            die(f'{table} lacks column(s) {", ".join(missing)} (contract: graph/test/web/tools/normalize.py)')
        return self.db.execute(f'select {", ".join(cols)} from {table}').fetchall()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    kinds_arg = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--kinds=')), '')
    kinds = set(kinds_arg.split(',')) if kinds_arg else None
    out_dir = args[0]
    want = (lambda k: kinds is None or k in kinds)
    out = []
    emit = (lambda kind, *f: out.append('\t'.join([kind] + [esc(x) for x in f])) if want(kind) else None)

    JS_KINDS = {'js_function', 'dom_touch'}
    web_needed = kinds is None or bool(kinds - JS_KINDS)
    if web_needed:
        g = Graph(os.path.join(out_dir, 'web', 'graph.sqlite'))
        key = {}
        pages = g.rows('web_pages', ['uid', 'file', 'document_kind'])
        for uid, f, dk in pages:
            key[uid] = f
            emit('page', f, dk)
        els = g.rows('web_elements', ['uid', 'page_uid', 'parent_uid', 'file', 'line', 'col', 'tag_name', 'html_id', 'class_names'])
        for uid, _p, _par, f, ln, col, *_ in els:
            key[uid] = f'{f}:{ln}:{col}'
        for uid, p, par, f, ln, col, tag, hid, cls in els:
            emit('element', key[uid], tag, hid, ' '.join((cls or '').split()))
            emit('contains', key.get(par) if par else key.get(p), key[uid])
        attrs = g.rows('web_attributes', ['uid', 'element_uid', 'name', 'value'])
        attr_name = {}
        for uid, e, n, v in attrs:
            attr_name[uid] = n
            emit('attribute', key.get(e), n, v)
        for _u, e, pos, c in g.rows('web_class_tokens', ['uid', 'element_uid', 'position', 'class_name']):
            emit('class_token', key.get(e), pos, c)
        for _u, e, a, url, uk, res in g.rows('web_references', ['uid', 'element_uid', 'attribute_name', 'url_as_written', 'url_kind', 'resolved_file']):
            emit('reference', key.get(e), a, url, URL_KIND.get(uk, uk), res)
        for _u, e, sk, st, res, mod in g.rows('web_scripts', ['uid', 'element_uid', 'script_kind', 'script_type', 'resolved_file', 'js_module_path']):
            emit('script', key.get(e), sk, st, mod if sk == 'INLINE' else res)
        for _u, e, a, src, callee, mod in g.rows('web_handler_calls', ['uid', 'element_uid', 'attribute_uid', 'handler_source', 'callee_name', 'js_module_path']):
            emit('handler_call', key.get(e), attr_name.get(a), src, callee, mod if src == 'EVENT_ATTRIBUTE' else None)
        for _u, e, a, t in g.rows('web_template_exprs', ['uid', 'element_uid', 'attribute_uid', 'expression_text']):
            emit('template_expr', key.get(e), attr_name.get(a) if a else '#text', (t or '').strip())
        sheets = g.rows('web_stylesheets', ['uid', 'file', 'source_kind', 'owner_element_uid'])
        for uid, f, sk, owner in sheets:
            key[uid] = f if sk == 'FILE' else f'style@{key.get(owner)}'
            emit('stylesheet', key[uid], SOURCE.get(sk, sk))
        rules = g.rows('web_rules', ['uid', 'stylesheet_uid', 'parent_uid', 'file', 'line', 'col', 'rule_kind', 'at_rule_name', 'prelude_text'])
        for uid, _s, _p, f, ln, col, *_ in rules:
            key[uid] = f'{f}:{ln}:{col}'
        kf_parent = {uid for uid, *_r, rk, at, _pre in rules if rk == 'AT_RULE' and (at or '').lower().endswith('keyframes')}
        for uid, _s, par, f, ln, col, rk, at, pre in rules:
            kind = f'@{(at or "").lower()}' if rk == 'AT_RULE' else ('keyframe' if par in kf_parent else 'style')
            emit('rule', key[uid], kind, ' '.join((pre or '').split()), key.get(par) if par else None)
            if rk == 'AT_RULE' and (at or '').lower().endswith('keyframes'):
                emit('keyframes', key[uid], (pre or '').strip().strip('"\''))
        sels = g.rows('web_selectors', ['uid', 'rule_uid', 'position', 'selector_text', 'spec_a', 'spec_b', 'spec_c'])
        keyframe_rules = {uid for uid, _s, par, *_x in rules if par in kf_parent}
        for uid, r, pos, t, a, b, c in sels:
            key[uid] = f'{key.get(r)}/{pos}'
            if r in keyframe_rules:
                continue  # `from`/`to`/`50%` select keyframes, not elements; the oracle has no selector row for them
            emit('selector', key[uid], ' '.join((t or '').split()), f'{a},{b},{c}' if a is not None else None)
        for _u, s, pk, n in g.rows('web_selector_parts', ['uid', 'selector_uid', 'part_kind', 'name']):
            if pk in ('TYPE', 'UNIVERSAL', 'CLASS', 'ID', 'ATTRIBUTE', 'PSEUDO_CLASS', 'PSEUDO_ELEMENT', 'NESTING', 'RAW'):
                emit('selector_part', key.get(s), pk, n)
        attr_owner = {uid: e for uid, e, _n, _v in attrs}
        decls = g.rows('web_declarations', ['uid', 'rule_uid', 'attribute_uid', 'file', 'line', 'col', 'property', 'value_text', 'is_important'])
        custom = set()
        for uid, r, a, f, ln, col, prop, val, imp in decls:
            key[uid] = f'{f}:{ln}:{col}'
            owner = key.get(r) if r else f'attr@{key.get(attr_owner.get(a))}'
            emit('declaration', key[uid], owner, prop, (val or '').strip(), 1 if str(imp).lower() in ('1', 'true') else 0)
            if (prop or '').startswith('--'):
                custom.add(prop)
        refs = g.rows('web_value_refs', ['uid', 'declaration_uid', 'rule_uid', 'reference_kind', 'name', 'fallback_text', 'url_kind', 'resolved_file'])
        decl_rule = {uid: r for uid, r, *_x in decls}
        fontface_rules = {uid for uid, *_r, rk, at, _pre in rules if (at or '').lower() == 'font-face'}
        for uid, d, r, rk, n, fb, uk, res in refs:
            key[uid] = key.get(d) if d else key.get(r)
            if rk == 'FONT_FAMILY' and decl_rule.get(d) in fontface_rules:
                continue  # the @font-face descriptor DEFINES the family; the oracle has no use row for it
            emit('value_ref', key.get(d) if d else key.get(r), rk, n, fb if rk == 'VARIABLE' else URL_KIND.get(uk, uk), res)
        for _u, f, ln, col in g.rows('web_comments', ['uid', 'file', 'line', 'col']):
            emit('comment', f'{f}:{ln}:{col}')
        # derived name nodes
        for uid, _s, _p, f, ln, col, rk, at, pre in rules:
            if (at or '').lower() == 'property' and (pre or '').strip().startswith('--'):
                custom.add(pre.strip())
        for c in custom:
            emit('custom_property', c)
        ids = {}
        for uid, p, _par, *_r, hid, _cls in els:
            if hid:
                ids[(key.get(p), hid)] = ids.get((key.get(p), hid), 0) + 1
        for (p, hid), n in ids.items():
            emit('id', p, hid, n)
        # font_face: the @font-face rule and its font-family descriptor
        ff = {r: (val or '').strip().strip('"\'') for _u, r, _a, _f, _l, _c, prop, val, _i in decls if r and (prop or '').lower() == 'font-family'}
        rule_by = {r[0]: r for r in rules}
        for uid, _s, _p, *_x, rk, at, _pre in rules:
            if (at or '').lower() == 'font-face':
                emit('font_face', key[uid], ff.get(uid))
        # layer: every name an @layer rule declares (block prelude, or each name of a statement),
        # dotted through the @layer blocks around it, plus each `@import ... layer(x)` name
        layers = set()
        for uid, _s, par, *_x, rk, at, pre in rules:
            if (at or '').lower() != 'layer' or not (pre or '').strip():
                continue
            prefix, p = [], par
            while p and p in rule_by:
                pr = rule_by[p]
                if (pr[7] or '').lower() == 'layer' and (pr[8] or '').strip():
                    prefix.insert(0, pr[8].strip())
                p = pr[2]
            for n in [x.strip() for x in pre.split(',') if x.strip()]:
                layers.add('.'.join(prefix + [n]))
        import_rules = {uid for uid, *_r, rk, at, _pre in rules if (at or '').lower() == 'import'}
        layers |= {n for _u, _d, r, rk, n, *_x in refs if rk == 'LAYER' and n and r in import_rules}
        for n in layers:
            emit('layer', n)
        for n in {n for _u, _d, _r, rk, n, *_x in refs if rk == 'CONTAINER' and n}:
            emit('container', n)
        # edges
        for p, s, url, via, order, depth, st, rs in g.rows('web_loads', ['page_uid', 'stylesheet_uid', 'url_as_written', 'via', 'load_order', 'import_depth', 'status', 'reason']):
            emit('loads_sheet', key.get(p), key.get(s) if s else url, via, order if s else None, depth, st, rs)
        for a, b, url, st, rs in g.rows('web_imports', ['from_stylesheet_uid', 'to_stylesheet_uid', 'url_as_written', 'status', 'reason']):
            emit('imports', key.get(a), key.get(b) if b else url, st, rs)
        for e, an, tp, te, url, st, rs in g.rows('web_links', ['from_element_uid', 'attribute_name', 'to_page_uid', 'to_element_uid', 'url_as_written', 'status', 'reason']):
            emit('links_to', key.get(e), an, key.get(tp) if tp else url, key.get(te) if te else None, st, rs)
        for e, an, idv, te, st, rs in g.rows('web_id_refs', ['from_element_uid', 'attribute_name', 'id_value', 'to_element_uid', 'status', 'reason']):
            emit('id_ref', key.get(e), an, idv, key.get(te) if te else None, st, rs)
        if want('styles') or want('cascade'):
            for s, e, p, st, rs, pe, cond, a, b, c, lr, so, ro, ic in g.rows('web_styles', [
                    'selector_uid', 'element_uid', 'page_uid', 'status', 'reason', 'pseudo_element', 'conditions',
                    'spec_a', 'spec_b', 'spec_c', 'layer_rank', 'sheet_order', 'rule_order', 'important_count']):
                emit('styles', key.get(s), key.get(e), st, ';'.join(sorted((rs or '').split(';'))) if rs and rs != '-' else None, pe)
                if st != 'unknown':
                    emit('cascade', key.get(p), key.get(s), key.get(e), so, ro, lr, f'{a},{b},{c}', ic, cond)
        for tbl, kind in (('web_var', 'var'), ('web_keyframes_use', 'keyframes_use'), ('web_font_use', 'font_use'), ('web_container_use', 'container_use')):
            if want(kind):
                for u, n, t, p, st, rs in g.rows(tbl, ['use_uid', 'name', 'def_uid' if kind == 'var' else 'target_uid', 'page_uid', 'status', 'reason']):
                    emit(kind, key.get(u), n, key.get(t) if t else None, key.get(p), st, rs)
        for kind, n, p, rs, _d in g.rows('web_unknown', ['kind', 'node_uid', 'page_uid', 'reason', 'detail']):
            emit('unknown', rs, key.get(n, n), key.get(p) if p else None)

    if kinds is None or kinds & JS_KINDS:
        js = Graph(os.path.join(out_dir, 'javascript', 'graph.sqlite'))
        if want('js_function'):
            for name, qn, fp, ln, mk in js.rows('methods', ['name', 'qualified_name', 'file_path', 'start_line', 'kind']):
                if mk == 'MODULE_INITIALIZER':
                    continue  # the module's top level is not a function
                mod = fp
                for marker in ('#script-', '#on-'):
                    if qn and marker in qn:
                        head, tail = qn.split(marker, 1)
                        num = ''.join(ch for ch in tail if ch.isdigit()) or tail.split('.')[0]
                        mod = f'{fp}{marker}{num}'
                nm = '' if (not name or name.startswith('<') or 'anonymous' in name.lower()) else name
                emit('js_function', mod, ln, nm)
        if want('dom_touch'):
            for f, ln, api, ai, lit, toks, st in js.rows('ext_dom_touch', ['file', 'line', 'api', 'arg_index', 'literal', 'tokens', 'status']):
                emit('dom_touch', f, ln, api, ai, lit if st == 'literal' else None, toks if st == 'literal' else None)

    out.sort()
    sys.stdout.write(''.join(r + '\n' for r in out))


if __name__ == '__main__':
    main()
