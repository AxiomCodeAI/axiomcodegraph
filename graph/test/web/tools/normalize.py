#!/usr/bin/env python3
"""Normalize the engine's web graph (HTML and CSS only) into the
oracle's row vocabulary, so a case compares as a sorted multiset diff.

  normalize.py <out-dir> [--kinds=a,b,...]     prints rows on stdout, sorted

<out-dir> is what `bin/axiomcode <src> <out-dir>` writes: <out-dir>/web/graph.sqlite and, for the
(the web layer is HTML and CSS only: no JavaScript table is read here).

THE CONTRACT (the engine's tables this reads; SPEC.md section 5.1 in concrete column names).
Every web node table has `uid` (the parser's unique hash), `file` (repo-relative), `line`, `col`
(1-based start of the node in the file on disk). NULL is written as '-'.

  web_pages(uid, file, document_kind)
  web_elements(uid, page_uid, parent_uid, file, line, col, tag_name, html_id, class_names, inert)
             class_names space-separated as written; inert = template | noscript | iframe_text | NULL.
             [iter1b G11] iframe_text elements (markup between <iframe> and </iframe>, text to a browser) are
             dropped here with everything hanging off them: the oracle has them as text
  web_attributes(uid, element_uid, name, value)
  web_class_tokens(uid, element_uid, position, class_name)
  web_references(uid, element_uid, attribute_name, url_as_written, url_kind, resolved_file)    url_kind = parser WebUrlKind
  web_script(uid, page_uid, element_uid, file, ordinal, type_as_written, script_type, kind, attributes, src,
             resolved_file, body_line, body_col, body_end_line, body_end_col, body, body_bytes, body_lines)  [SPEC 10]
             kind external|inline; attributes = JSON object of every attribute as written (compared with sorted
             keys); body = the exact source text between the tags, byte for byte; body_lines = line breaks + 1
             (0 for an empty body); body range = first char after the start tag .. the `<` of `</script>`
  web_handler(uid, page_uid, element_uid, file, line, col, attr_as_written, event, event_source, modifiers, source_kind,
              code, code_bytes)  [SPEC 10] one row per handler attribute (one per `#` descriptor for data-action);
              event_source written | stimulus_default | stimulus_default_unknown
  web_gaps(uid, element_uid, gap_kind, detail)     compared only where a case asks for `html_gap`
  web_template_exprs(uid, element_uid, attribute_uid, expression_text)                         attribute_uid NULL = element text
  web_stylesheets(uid, file, source_kind, owner_element_uid)                                    source_kind FILE | HTML_STYLE_ELEMENT
  web_rules(uid, stylesheet_uid, parent_uid, file, line, col, rule_kind, at_rule_name, prelude_text)
  web_selectors(uid, rule_uid, position, selector_text, spec_a, spec_b, spec_c, usage, unknown_reason, pages_loading,
                pages_matched, pages_unmatched)   [iter2 grain] usage per SPEC 9.9; no_static_carrier lives HERE
  web_rules.usage                                  best usage of its selectors
  web_selector_unmatched_pages(selector_uid, page_uid, unknown_reason)  VIEW: pages where a required class or id
                                                   has no static carrier; rows WHERE unknown_reason='no_static_carrier'
                                                   are emitted as `unknown no_static_carrier <selector> <page>`
  web_selector_parts(uid, selector_uid, part_kind, name)
  web_declarations(uid, rule_uid, attribute_uid, file, line, col, property, value_text, is_important)
  web_value_refs(uid, declaration_uid, rule_uid, reference_kind, name, fallback_text, url_kind, resolved_file)
  web_comments(uid, file, line, col)
  web_loads(page_uid, stylesheet_uid, url_as_written, via, load_order, import_depth, status, reason)
  web_imports(from_stylesheet_uid, to_stylesheet_uid, url_as_written, status, reason)
  web_links(from_element_uid, attribute_name, to_page_uid, to_element_uid, url_as_written, status, reason)
  web_id_refs(from_element_uid, attribute_name, id_value, to_element_uid, status, reason)
  web_styles(selector_uid, element_uid, page_uid, status, reason, pseudo_element, conditions,
             spec_a, spec_b, spec_c, layer_rank, sheet_order, rule_order, important_count,
             scope_root, scope_proximity)
             reason: every reason, sorted, ';'-joined ('state:hover;at_rule:media' -> 'at_rule:media;state:hover')
             + scope_root (element uid, NULL outside @scope), scope_proximity (generations root -> subject)  [iter1b]
             [iter3, SPEC 11.2] + host_page_uid: set when the element is an included fragment's, matched in that
             host's composed tree; such a row is emitted as
             -> host_styles <selector> <element> <host page> <status> <reasons> <pseudo>   (no cascade/scope row)
  web_includes(host_page_uid, fragment_page_uid, kind, host_element_uid, position, reference_uid, file, line, col, args,
               status, reason)       reference_uid keys web_unknown rows on an include as include@<file:line:col>
             -> include <host> <fragment> <kind> <host element> <position> <file:line:col of the directive> <args>
                <status> <reason>   [iter3, SPEC 11.2]
  web_var_scope(page_uid, element_uid, name, root_uid, root_exact_uid, status, reason)   SPEC 3.4a, V1-12: one row per (page, element, name)
  web_var(use, def, page, status, reason)   [iter1b] the SQL VIEW over web_var_def / web_var_visible /
             web_var_scope (SPEC 3.4a); use = the VARIABLE value_ref uid (its declaration and name are read
             from web_value_refs), def = the defining declaration uid or the @property rule uid, NULL when none
  web_keyframes_use(use_uid, name, target_uid, page_uid, status, reason)  use_uid = declaration
  web_font_use(use_uid, name, target_uid, page_uid, status, reason)
  web_container_use(use_uid, name, target_uid, page_uid, status, reason)  use_uid = the @container rule
  web_unknown(kind, node_uid, page_uid, reason, detail)                  orphan_sheet, fragment_no_host,
             no_static_carrier, shadow_dom, selector_unparsed, implied_element, column_combinator, lang_unknown

  [iter2, SPEC 9] conversion layer (one row kind per table; keys as above, `-` for NULL):
  web_components(uid, level, size, occurrences, pages) + web_component_occurrences(component_uid, element_uid)
             -> component <level> <occurrence keys sorted, comma-joined> <size> <occurrences> <pages>
  web_component_slots(component_uid, path, kind, attribute_name, distinct_values)  (component uids only)
             -> component_slot <level> <first occurrence key> <path ('.' = root)> <text|attr|class> <attr> <n>
  web_repeats(parent_element_uid, first_element_uid, start_position, count, item_tag, item_size, uniform)
  web_computed(element_uid, pseudo, property, winner_decl_uid, winner_status, contenders, conditional_overrides,
               override_decl_uid)
  web_cascade VIEW (element, pseudo, property, decl, outcome, lost_reason)  -> cascade_entry rows
  web_tokens(kind, value, uses, project_uses)
  web_breakpoints(uid, media, min_px, max_px, unit, rules, sheets) + web_rule_breakpoints(rule_uid, breakpoint_uid, depth)
  web_forms(element_uid, action, action_resolved_page, method, controls, implicit_action)  [V2-11] no action attribute:
             action = the page itself, implicit_action 1
  [iter3 orchestrator rulings, read when the column exists; absent -> the rows are missing and the gate fails]
  web_class_tokens.dynamic            -> dynamic_class_token <element> <position> <token>   (V2-15)
  web_attributes.file, .line          -> attr_at <element> <name> <file:line>               (V2-01 via_at)
  web_styles.loads (sheet orders)     -> styles_loads <selector> <element> <page> <orders>  (V2-22, > 1 load only)
  web_tokens.unused                   -> last column of token                               (V2-06)
  web_form_controls(element_uid, form_uid, tag, type, name, required, label_uid, label_via)
  web_icon_classes(class_name, rule_uid, content, font_family, used_elements)
  web_outline(uid, element_uid, page_uid, kind, name, level, parent_outline_uid, ordinal)
  web_classes(class_name, elements, pages, selectors_naming, selectors_matching, styled, icon)

Row keys (identical to the oracle's): page = file; element = file:line:col; sheet = file for a FILE
sheet, style@<element key> for a <style>; rule = file:line:col; selector = <rule key>/<position>;
declaration = file:line:col; value_ref owner = its declaration key or (at-rule refs) its rule key.
"""
import json
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

    def has(self, table, col):
        return table in self.tables and col in {r[1] for r in self.db.execute(f'pragma table_info({table})')}

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

    web_needed = True
    if web_needed:
        g = Graph(os.path.join(out_dir, 'web', 'graph.sqlite'))
        key = {}
        pages = g.rows('web_pages', ['uid', 'file', 'document_kind'])
        for uid, f, dk in pages:
            key[uid] = f
            emit('page', f, dk)
        els_all = g.rows('web_elements', ['uid', 'page_uid', 'parent_uid', 'file', 'line', 'col', 'tag_name', 'html_id', 'class_names', 'inert'])
        iframe_text = {r[0] for r in els_all if r[9] == 'iframe_text'}
        els = [r[:9] for r in els_all if r[0] not in iframe_text]
        for uid, _p, _par, f, ln, col, *_ in els:
            key[uid] = f'{f}:{ln}:{col}'
        for uid, p, par, f, ln, col, tag, hid, cls in els:
            emit('element', key[uid], tag, hid, ' '.join((cls or '').split()))
            emit('contains', key.get(par) if par else key.get(p), key[uid])
        attrs = g.rows('web_attributes', ['uid', 'element_uid', 'name', 'value'])
        a_line, a_file = {}, {}
        if g.has('web_attributes', 'line') and g.has('web_attributes', 'file'):
            for uid, f, ln in g.rows('web_attributes', ['uid', 'file', 'line']):
                a_line[uid], a_file[uid] = ln, f
        attr_name = {}
        attrs = [a for a in attrs if a[1] not in iframe_text]
        for uid, e, n, v in attrs:
            attr_name[uid] = n
            emit('attribute', key.get(e), n, v)
            if a_line.get(uid) is not None:
                emit('attr_at', key.get(e), n, f'{a_file.get(uid)}:{a_line[uid]}')
        dyn_col = 'dynamic' if g.has('web_class_tokens', 'dynamic') else None
        for _u, e, pos, c, *dy in g.rows('web_class_tokens', ['uid', 'element_uid', 'position', 'class_name'] + ([dyn_col] if dyn_col else [])):
            if e in iframe_text:
                continue
            emit('class_token', key.get(e), pos, c)
            if dy and str(dy[0]).lower() in ('1', 'true'):
                emit('dynamic_class_token', key.get(e), pos, c)
        for _u, e, a, url, uk, res in g.rows('web_references', ['uid', 'element_uid', 'attribute_name', 'url_as_written', 'url_kind', 'resolved_file']):
            if e in iframe_text:
                continue
            emit('reference', key.get(e), a, url, URL_KIND.get(uk, uk), res)
        if want('script') or want('script_body'):
            for (_u, e, ordinal, tw, st, kind, sattrs, res, bl, bc, bel, bec, body, nbytes, nlines) in g.rows('web_script', [
                    'uid', 'element_uid', 'ordinal', 'type_as_written', 'script_type', 'kind', 'attributes', 'resolved_file',
                    'body_line', 'body_col', 'body_end_line', 'body_end_col', 'body', 'body_bytes', 'body_lines']):
                try:
                    attrs_c = json.dumps(json.loads(sattrs or '{}'), sort_keys=True, separators=(',', ':'), ensure_ascii=False)
                except ValueError:
                    attrs_c = f'<not JSON: {sattrs}>'
                emit('script', key.get(e), ordinal, kind, st, tw, attrs_c, res if kind == 'external' else None,
                     f'{bl}:{bc}-{bel}:{bec}' if kind == 'inline' else None)
                if kind == 'inline':
                    emit('script_body', key.get(e), nbytes, nlines, '|' + (body if body is not None else '<NULL>'))
        if want('handler'):
            for _u, e, an, ev, es, mods, sk, code, cb in g.rows('web_handler', ['uid', 'element_uid', 'attr_as_written', 'event',
                                                                                'event_source', 'modifiers', 'source_kind', 'code', 'code_bytes']):
                emit('handler', key.get(e), an, ev, es, mods, sk, cb, '|' + (code or ''))
        if want('html_gap'):
            for _u, e, gk, det in g.rows('web_gaps', ['uid', 'element_uid', 'gap_kind', 'detail']):
                if e:
                    emit('html_gap', key.get(e), gk, det)
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
        kf_rules_all = keyframe_rules | {uid for uid, *_r, rk, _at, _pre in rules if rk == 'AT_RULE'}
        for uid, r, pos, t, a, b, c in sels:
            key[uid] = f'{key.get(r)}/{pos}'
            if r in keyframe_rules:
                continue  # `from`/`to`/`50%` select keyframes, not elements; the oracle has no selector row for them
            emit('selector', key[uid], ' '.join((t or '').split()), f'{a},{b},{c}' if a is not None else None)
        kf_sels = {uid for uid, r, *_x in sels if r in keyframe_rules}
        if want('usage') or want('unknown'):
            sel_reason = {}
            for uid, us, ur, pl, pm, pu in g.rows('web_selectors', ['uid', 'usage', 'unknown_reason', 'pages_loading', 'pages_matched', 'pages_unmatched']):
                sel_reason[uid] = ur
                if uid in key and uid not in kf_sels:
                    emit('usage', key[uid], us, ur, pl, pm, pu)
            for s_uid, p_uid, ur in g.rows('web_selector_unmatched_pages', ['selector_uid', 'page_uid', 'unknown_reason']):
                if ur == 'no_static_carrier':
                    emit('unknown', 'no_static_carrier', key.get(s_uid), key.get(p_uid))
        if want('rule_usage'):
            for uid, us in g.rows('web_rules', ['uid', 'usage']):
                if uid in key and uid not in kf_rules_all:
                    emit('rule_usage', key[uid], us)
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
        # an include's reference is keyed by its position (web_unknown rows name it): include@file:line:col
        incl = g.rows('web_includes', ['host_page_uid', 'fragment_page_uid', 'kind', 'host_element_uid', 'position', 'file',
                                       'line', 'col', 'args', 'status', 'reason', 'reference_uid'])
        for *_x, f, ln, col, _a, _s, _r, ru in incl:
            if ru:
                key.setdefault(ru, f'include@{f}:{ln}:{col}')
        if want('include'):
            for h, fr, kd, he, pos, f, ln, col, args, st, rs, _ru in incl:
                emit('include', key.get(h, h) if h else None, key.get(fr, fr) if fr else None, kd, key.get(he, he) if he else None,
                     pos, f'{f}:{ln}:{col}', (args or '').strip(), st, rs)
        # [V2-22] web_styles.loads: every sheet_order of the loads of the row's sheet on the page (one row per
        # (selector, element, page)); emitted as styles_loads when there is more than one
        s_loads = {}
        if want('styles_loads') and g.has('web_styles', 'loads'):
            for s_, e_, p_, lo in g.rows('web_styles', ['selector_uid', 'element_uid', 'page_uid', 'loads']):
                s_loads[(s_, e_, p_)] = lo
        if want('styles') or want('cascade') or want('scope') or want('host_styles') or want('styles_loads'):
            for s, e, p, st, rs, pe, cond, a, b, c, lr, so, ro, ic, sr, sp, hp in g.rows('web_styles', [
                    'selector_uid', 'element_uid', 'page_uid', 'status', 'reason', 'pseudo_element', 'conditions',
                    'spec_a', 'spec_b', 'spec_c', 'layer_rank', 'sheet_order', 'rule_order', 'important_count',
                    'scope_root', 'scope_proximity', 'host_page_uid']):
                if hp:
                    emit('host_styles', key.get(s), key.get(e, e), key.get(hp, hp), st, ';'.join(sorted((rs or '').split(';'))) if rs and rs != '-' else None, pe)
                    continue
                if e in iframe_text:
                    print(f'normalize: web_styles row on an iframe_text element {e} (SPEC 3.6 G11: never styled)', file=sys.stderr)
                emit('styles', key.get(s) if e not in iframe_text else key.get(s), key.get(e) if e not in iframe_text else f'iframe_text:{e}', st, ';'.join(sorted((rs or '').split(';'))) if rs and rs != '-' else None, pe)
                if sr:
                    emit('scope', key.get(s), key.get(e), key.get(sr), sp)
                if st != 'unknown':
                    emit('cascade', key.get(p), key.get(s), key.get(e), so, ro, lr, f'{a},{b},{c}', ic, cond)
                    if want('styles_loads') and s_loads.get((s, e, p)):
                        lo = sorted({int(x) for x in str(s_loads[(s, e, p)]).replace(';', ',').split(',') if x.strip().isdigit()})
                        if len(lo) > 1:
                            emit('styles_loads', key.get(s), key.get(e), key.get(p), ','.join(map(str, lo)))
        b = lambda v: 1 if str(v).lower() in ('1', 'true') else 0
        if want('component') or want('component_slot'):
            occ = {}
            for cu, eu in g.rows('web_component_occurrences', ['component_uid', 'element_uid']):
                occ.setdefault(cu, []).append(key.get(eu, eu))
            comps = {}
            for cu, lvl, size, n, pg in g.rows('web_components', ['uid', 'level', 'size', 'occurrences', 'pages']):
                ks = sorted(occ.get(cu, []))
                comps[cu] = (lvl, ks[0] if ks else None)
                emit('component', lvl, ','.join(ks), size, n, pg)
            if want('component_slot'):
                for cu, path, kind, an, dv in g.rows('web_component_slots', ['component_uid', 'path', 'kind', 'attribute_name', 'distinct_values']):
                    if cu not in comps:
                        continue  # a repeat's slots
                    if kind and kind.startswith('attr:'):
                        kind, an = 'attr', kind[5:]
                    emit('component_slot', comps[cu][0], comps[cu][1], path or '.', kind, an, dv)
        if want('repeat'):
            for pe, fe, sp, n, tag, isz, uni in g.rows('web_repeats', ['parent_element_uid', 'first_element_uid', 'start_position', 'count', 'item_tag', 'item_size', 'uniform']):
                emit('repeat', key.get(pe), key.get(fe), sp, n, tag, isz, b(uni))
        if want('computed'):
            for e, ps, pr, w, ws, nc, co, ov in g.rows('web_computed', ['element_uid', 'pseudo', 'property', 'winner_decl_uid', 'winner_status', 'contenders', 'conditional_overrides', 'override_decl_uid']):
                emit('computed', key.get(e), ps, pr, key.get(w) if w else None, ws, nc, co, key.get(ov) if ov else None)
        if want('cascade_entry'):
            for e, ps, pr, d, oc, lr in g.rows('web_cascade', ['element', 'pseudo', 'property', 'decl', 'outcome', 'lost_reason']):
                emit('cascade_entry', key.get(e), ps, pr, key.get(d), oc, lr)
        if want('token'):
            un_col = ['unused'] if g.has('web_tokens', 'unused') else []
            for k, v, u, pu, *un in g.rows('web_tokens', ['kind', 'value', 'uses', 'project_uses'] + un_col):
                emit('token', k, v, u, pu, b(un[0]) if un else None)
        if want('breakpoint') or want('rule_breakpoint'):
            media = {}
            for bu, m, mn, mx, un, nr, ns in g.rows('web_breakpoints', ['uid', 'media', 'min_px', 'max_px', 'unit', 'rules', 'sheets']):
                media[bu] = m
                emit('breakpoint', m, mn, mx, un, nr, ns)
            if want('rule_breakpoint'):
                for ru, bu, dp in g.rows('web_rule_breakpoints', ['rule_uid', 'breakpoint_uid', 'depth']):
                    emit('rule_breakpoint', key.get(ru), media.get(bu), dp)
        if want('form'):
            ia_col = ['implicit_action'] if g.has('web_forms', 'implicit_action') else []
            for e, ac, ap, me, nc, *ia in g.rows('web_forms', ['element_uid', 'action', 'action_resolved_page', 'method', 'controls'] + ia_col):
                emit('form', key.get(e), ac, key.get(ap, ap) if ap else None, (me or 'get').lower(), nc, b(ia[0]) if ia else None)
        if want('form_control'):
            for e, fu, tag, ty, nm, rq, lu, lv in g.rows('web_form_controls', ['element_uid', 'form_uid', 'tag', 'type', 'name', 'required', 'label_uid', 'label_via']):
                emit('form_control', key.get(e), key.get(fu) if fu else None, tag, ty, nm, b(rq), key.get(lu) if lu else None, lv)
        if want('icon_class'):
            for c, ru, ct, ff, ue in g.rows('web_icon_classes', ['class_name', 'rule_uid', 'content', 'font_family', 'used_elements']):
                emit('icon_class', c, key.get(ru), ct, ff, ue)
        if want('outline'):
            orows = g.rows('web_outline', ['uid', 'element_uid', 'page_uid', 'kind', 'name', 'level', 'parent_outline_uid', 'ordinal'])
            el_of = {u: e for u, e, *_x in orows}
            for u, e, pu, kd, nm, lv, par, od in orows:
                emit('outline', key.get(pu), od, key.get(e), kd, nm, lv, key.get(el_of.get(par)) if par else None)
        if want('class'):
            for c, ne, npg, sn, sm, st, ic in g.rows('web_classes', ['class_name', 'elements', 'pages', 'selectors_naming', 'selectors_matching', 'styled', 'icon']):
                emit('class', c, ne, npg, sn, sm, b(st), b(ic))
        if want('var_scope'):
            for p, e, n, r, st, rs, rx in g.rows('web_var_scope', ['page_uid', 'element_uid', 'name', 'root_uid', 'status', 'reason', 'root_exact_uid']):
                emit('var_scope', key.get(p), key.get(e), n, key.get(r) if r else None, st if r else 'unknown', rs, key.get(rx) if rx else None)
        if want('var'):
            vref = {uid: (key.get(d) if d else key.get(r), n) for uid, d, r, rk, n, *_x in refs if rk == 'VARIABLE'}
            for u, d, p, st, rs in g.rows('web_var', ['use', 'def', 'page', 'status', 'reason']):
                if u not in vref:
                    die(f'web_var.use {u} is not a VARIABLE value_ref uid (contract: graph/test/web/tools/normalize.py)')
                owner, name = vref[u]
                emit('var', owner, name, key.get(d) if d else None, key.get(p), st, rs)
        for tbl, kind in (('web_keyframes_use', 'keyframes_use'), ('web_font_use', 'font_use'), ('web_container_use', 'container_use')):
            if want(kind):
                for u, n, t, p, st, rs in g.rows(tbl, ['use_uid', 'name', 'target_uid', 'page_uid', 'status', 'reason']):
                    emit(kind, key.get(u), n, key.get(t) if t else None, key.get(p), st, rs)
        for kind, n, p, rs, _d in g.rows('web_unknown', ['kind', 'node_uid', 'page_uid', 'reason', 'detail']):
            # [iter2 grain] a no_static_carrier row here is a grain defect: kept under its own name so the gate fails
            emit('unknown', rs if rs != 'no_static_carrier' else 'no_static_carrier_in_web_unknown', key.get(n, n), key.get(p) if p else None)

    out.sort()
    sys.stdout.write(''.join(r + '\n' for r in out))


if __name__ == '__main__':
    main()
