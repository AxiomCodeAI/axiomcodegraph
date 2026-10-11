/**
 * THE WEB GRAPH'S NAMED TABLES — HTML and CSS as one language (`run.language = 'web'`).
 *
 * The core call-graph tables exist in a web graph and are EMPTY: a page has no methods. What a
 * web graph holds is below: one node table per IR entity (one row per IR row, ids are the
 * parser's hashes) and the in-web edge tables the engine (graph/web/engine) and the bundle's
 * matcher (graph/bundle/web/select.ts) derive. Every edge row has a `status`:
 *
 *   match        decided statically, and true;
 *   conditional  true in some state the page can be in (a :hover, an @media, an initial
 *                form state, an inert <template>); `reason` names the condition;
 *   unknown      cannot be decided from the source; `reason` says why and no target is guessed.
 *
 * Nothing here joins a web node to a JavaScript node: the join keys (a script's resolved file,
 * an inline script's module path, a handler's callee name) are kept as columns, per language.
 */
import type { ColumnSpec, TableSpec } from '@/bundle/schema';

const t = (name: string, description = ''): ColumnSpec => ({ name, type: 'TEXT', description, nullable: true });
const i = (name: string, description = ''): ColumnSpec => ({ name, type: 'INTEGER', description, nullable: true });
const id = (name: string, description = ''): ColumnSpec => ({ name, type: 'TEXT', description, nullable: true, indexed: true });

export const WEB_TABLES: readonly TableSpec[] = [
  // ── nodes ────────────────────────────────────────────────────────────────
  {
    name: 'web_pages',
    description: 'One HTML file (html_document). `file` is repository-relative; `quirks` = 1 when the page has no doctype (class and id selectors then match ASCII case-insensitively).',
    columns: [id('uid'), id('file'), t('name'), t('document_kind', 'DOCUMENT or FRAGMENT'), t('doctype'), i('quirks'), t('lang'), t('title'),
      t('template_dialects'), i('minified'), i('element_count'), i('script_count'), i('inline_script_count'), i('line'), i('end_line')],
  },
  {
    name: 'web_elements',
    description: 'One element as WRITTEN (implied tbody/html/head/body are not rows, LIMIT L1). `display` is tag#id.class1.class2; `position` the 0-based index among the parent\'s element children; `nth_of_type` 1-based; `inert` = 1 inside <template> or <noscript>; `dynamic_class` = 1 when a template directive or interpolation sets the class at run time.',
    columns: [id('uid'), id('page_uid'), id('parent_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col'), id('tag_name'), t('namespace'),
      i('depth'), i('position'), i('nth_of_type'), id('html_id', 'the id attribute'), t('class_names', 'as written, space-separated'), i('child_count'),
      t('text', 'direct text, cut at 1,024 chars'), t('inert', 'template | noscript | iframe_text (markup inside <iframe>, text to a browser: never styled) | NULL'), i('dynamic_class'), t('display')],
  },
  {
    name: 'web_attributes',
    description: 'One attribute (html_attribute). `kind` is what it does: ID, CLASS, STYLE, EVENT_HANDLER, URL, SRCSET, DATA, ARIA, FOR, ID_REFERENCE, NAME, TYPE, REL, TEMPLATE_DIRECTIVE, …',
    columns: [id('uid'), id('element_uid'), id('page_uid'), id('file'), i('line'), i('col'), id('name'), t('prefix'), t('value', 'cut at 4,096 chars'), t('kind'), i('has_value')],
  },
  {
    name: 'web_class_tokens',
    description: 'One token of a class attribute: what `.name` selectors and the JavaScript graph\'s DOM-touch literals name.',
    columns: [id('uid'), id('element_uid'), id('page_uid'), id('file'), i('line'), i('position'), id('class_name')],
  },
  {
    name: 'web_references',
    description: 'One URL a page names (html_reference): kind SCRIPT, STYLESHEET, ANCHOR, IMAGE, FORM_ACTION, FRAME, LINK_RESOURCE, MEDIA, META_REFRESH, BASE, REQUEST, OTHER. `resolved_file` is repository-relative and set only when the file is on disk.',
    columns: [id('uid'), id('element_uid'), id('page_uid'), id('file'), i('line'), i('col'), t('reference_kind'), t('attribute_name'), t('url_as_written'), t('url_kind'),
      t('path'), t('query'), t('fragment'), id('resolved_file'), i('is_resolved')],
  },
  {
    name: 'web_scripts',
    description: 'One <script> element (SPEC §10; view web_script), in page order (`order_on_page`): type as classified and as written, `attributes` (JSON of every attribute), module / nomodule / async / defer, src and the file it resolves to, or for an inline one the body range, `body` (the exact source text between the tags, sliced from the file: no entity decoding, CRLF kept, nothing trimmed; NULL with a web_unknown stale_source row when the file changed since parsing), `body_lines`, `body_bytes` and `inline_index`. Non-JavaScript types (JSON, importmap, templates) are rows too. Nothing here reads a body as JavaScript.',
    columns: [id('uid'), id('element_uid'), id('page_uid'), id('file'), i('line'), i('col'), i('order_on_page'), t('script_kind', 'EXTERNAL or INLINE'), t('script_type'),
      t('type_as_written'), t('attributes'), t('src'), id('resolved_file'), i('is_module'), i('is_async'), i('is_defer'), i('is_nomodule'), i('body_start_line'), i('body_start_col'),
      i('body_end_line'), i('body_end_col'), i('body_length'), i('body_lines'), i('body_bytes'), t('body'), i('inline_index')],
  },
  {
    name: 'web_handlers',
    description: 'One handler-bearing attribute or javascript: URL on an HTML tag (SPEC §10; view web_handler), in page order (`handler_index`): `attr_as_written` (original case, read from the source), `event` (lower-case DOM event; `htmx:x` for hx-on::x; `navigate` for a javascript: URL), `modifiers` (comma list), `source_kind` (on_attribute | javascript_url | vue | alpine | angular | angularjs | svelte | htmx | stimulus; one row per Stimulus descriptor), `code` as the attribute value reads (for javascript: the text after it; for Stimulus the descriptor) and `code_bytes`. Look-alikes (data-on*, onboarding, once, @x on a page with no Vue/Alpine, ng-if, data-action without #) are not rows. No JavaScript is parsed.',
    columns: [id('uid'), id('element_uid'), id('attribute_uid'), id('page_uid'), id('file'), id('tag'), t('attr_as_written'), id('event'), t('modifiers'), t('source_kind'),
      t('code'), i('code_bytes'), i('line'), i('col'), i('handler_index'), i('known_event', '1 when the event is in the DOM/HTML event-handler list')],
  },
  {
    name: 'web_handler_calls',
    description: 'One call the parser read in an on* attribute, a javascript: URL or a template event directive, by the name written (`callee_name`); `handler_index` is the on* attribute\'s place among the page\'s on* attributes. The attribute itself, with its raw text, is a web_attributes row of kind EVENT_HANDLER.',
    columns: [id('uid'), id('element_uid'), id('attribute_uid'), id('page_uid'), id('file'), i('line'), i('col'), t('handler_source'), t('event'), id('callee_name'),
      t('receiver'), t('callee_text'), i('argument_count'), i('is_new'), i('handler_index')],
  },
  {
    name: 'web_template_exprs',
    description: 'One template-dialect expression (Vue, Alpine, Angular, Jinja, Handlebars, ERB, …): a directive value or an interpolation (`attribute_uid` NULL: element text).',
    columns: [id('uid'), id('element_uid'), id('attribute_uid'), id('page_uid'), id('file'), i('line'), i('col'), t('dialect'), t('expression_kind'), t('directive'),
      t('argument'), t('modifiers'), t('expression_text'), t('callee_names'), t('identifiers'), t('declares')],
  },
  {
    name: 'web_stylesheets',
    description: 'One stylesheet: a .css file or a <style> element (`owner_element_uid`, `page_uid`). `display` is the file, or `<page><style#n>`. `vendor` = 1 for a sheet under vendor/, plugins/, bower_components/, lib/ or a .min.css (still matched: a vendor sheet a page loads styles that page).',
    columns: [id('uid'), id('file'), t('name'), t('source_kind'), id('owner_element_uid'), id('page_uid'), i('minified'), i('vendor'), i('rule_count'), i('declaration_count'),
      i('gap_count'), i('line'), i('end_line'), id('display'), i('loaded_by_pages', 'how many pages load it, directly or through @import')],
  },
  {
    name: 'web_rules',
    description: 'One rule: a style rule or an at-rule. `rule_order` is its 1-based pre-order position in its sheet; `layer` the dotted cascade layer it sits in (empty: unlayered); `conditions` the enclosing @media/@supports/@container/@scope/@starting-style/@document preludes, outermost first, joined by \' && \'; `in_keyframes` = 1 for a block inside @keyframes/@font-face/@page… (its selectors style no element).',
    columns: [id('uid'), id('stylesheet_uid'), id('parent_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col'), t('rule_kind'), t('at_rule_name'), id('name'),
      t('prelude_text'), i('nesting_depth'), i('position'), i('rule_order'), t('layer'), t('conditions'), i('in_keyframes'), i('important_count')],
  },
  {
    name: 'web_selectors',
    description: 'One complex selector of a style rule. `decidability`: exact, conditional (a state pseudo-class or an at-rule condition), unknown (with `reason`), none (a keyframe offset). spec_* is the specificity after nesting is resolved.',
    columns: [id('uid'), id('rule_uid'), id('stylesheet_uid'), id('file'), i('line'), i('col'), i('position'), id('selector_text'), i('spec_a'), i('spec_b'), i('spec_c'),
      i('compound_count'), i('has_nesting'), i('has_pseudo_element'), t('decidability'), t('reason'), i('pages_loading'), i('pages_matched'), i('elements_matched')],
  },
  {
    name: 'web_selector_parts',
    description: 'One simple selector (css_selector_part). `part_kind`: TYPE UNIVERSAL CLASS ID ATTRIBUTE PSEUDO_CLASS PSEUDO_ELEMENT NESTING RAW; arguments of :not()/:is()/:has()/:nth-child(of) have `parent_uid` and depth > 0.',
    columns: [id('uid'), id('selector_uid'), id('rule_uid'), i('line'), i('col'), t('part_kind'), id('name'), t('value'), t('matcher'), t('flags'), t('combinator'),
      i('compound_index'), i('position'), i('depth'), i('argument_index'), id('parent_uid')],
  },
  {
    name: 'web_declarations',
    description: 'One declaration, in a rule (`rule_uid`) or a style="" attribute (`attribute_uid`, `element_uid`).',
    columns: [id('uid'), id('rule_uid'), id('attribute_uid'), id('element_uid'), id('stylesheet_uid'), id('page_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col'),
      id('property'), t('value_text'), i('is_important'), i('is_custom'), t('vendor_prefix'), i('position')],
  },
  {
    name: 'web_value_refs',
    description: 'A name or URL a declaration value (or an at-rule prelude) refers to: VARIABLE (var(--x)), URL, IMPORT, KEYFRAMES, LAYER, CONTAINER, FONT_FAMILY. `resolved_file` only when the file is on disk.',
    columns: [id('uid'), id('declaration_uid'), id('rule_uid'), id('stylesheet_uid'), id('file'), i('line'), i('col'), t('reference_kind'), id('name'), t('fallback_text'),
      t('url_kind'), id('resolved_file'), i('is_resolved')],
  },
  {
    name: 'web_comments',
    description: 'One CSS comment.',
    columns: [id('uid'), id('stylesheet_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col'), t('text')],
  },
  {
    name: 'web_gaps',
    description: 'What a grammar could not read: `lang` html or css, the gap kind, and the page/sheet and rule/element it covers.',
    columns: [id('uid'), t('lang'), t('kind'), t('detail'), id('owner_uid', 'page (html) or sheet (css)'), id('related_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col')],
  },
  // ── edges ────────────────────────────────────────────────────────────────
  {
    name: 'web_loads',
    description: 'page -> stylesheet, in cascade order: `via` link | style | import; `load_order` 1-based (an @import\'ed sheet comes before the importing sheet\'s own rules, depth-first); `import_depth` 0 for a direct load; `via_uid` the link/style element or the importing sheet. A <link rel="alternate stylesheet"> is conditional alternate_sheet. An unknown row (no stylesheet_uid, no order) says why: external_url, unresolved_url, not_indexed, template_url.',
    columns: [id('page_uid'), id('stylesheet_uid'), t('url_as_written'), t('via'), id('via_uid'), i('load_order'), i('import_depth'), t('media'), t('layer'), t('status'), t('reason')],
  },
  {
    name: 'web_imports',
    description: 'stylesheet -> stylesheet by @import, with the IMPORT value reference; unknown rows say why the target is absent.',
    columns: [id('from_stylesheet_uid'), id('to_stylesheet_uid'), id('value_ref_uid'), t('url_as_written'), t('status'), t('reason')],
  },
  {
    name: 'web_links',
    description: 'element -> page by an anchor, form action, frame/iframe or meta refresh; `to_element_uid` is the target page\'s element with the URL\'s #fragment id, when there is one.',
    columns: [id('from_element_uid'), id('page_uid'), t('attribute_name'), id('to_page_uid'), id('to_element_uid'), t('kind'), id('reference_uid'), t('url_as_written'), t('fragment'), t('status'), t('reason')],
  },
  {
    name: 'web_id_refs',
    description: 'element -> element with the referenced id on the SAME page: href="#x", label for, aria-labelledby/-describedby/-controls/…, form/list/headers/popovertarget/commandfor. status ambiguous (one row per carrier) for a duplicated id; unknown no_such_id when no element has it.',
    columns: [id('from_element_uid'), id('page_uid'), t('attribute_name'), id('id_value'), id('to_element_uid'), t('status'), t('reason')],
  },
  {
    name: 'web_resources',
    description: 'element or declaration -> file: images, media, srcset candidates, link resources, scripts\' src, css url(). `file_exists` = 1 when the resolved file is on disk at index time.',
    columns: [id('from_uid'), t('from_kind'), id('owner_uid'), t('kind'), t('url'), id('file'), i('file_exists'), t('status'), t('reason')],
  },
  {
    name: 'web_styles',
    description: 'selector -> element: the rule applies to the element on that page (only through sheets the page loads). `reason` lists every condition, sorted, \';\'-joined. Cascade order fields per SPEC §3.3: sort by (important_count>0, layer_rank, spec_a, spec_b, spec_c, sheet_order, rule_order). `pseudo_element` set when the rule styles a ::before/::after/… of the element.',
    columns: [id('selector_uid'), id('rule_uid'), id('stylesheet_uid'), id('element_uid'), id('page_uid'), t('status'), t('reason'), t('conditions'), t('pseudo_element'),
      i('spec_a'), i('spec_b'), i('spec_c'), i('layer_rank'), i('sheet_order'), i('rule_order'), i('important_count'),
      id('scope_root', 'inside @scope: the scope root element'), i('scope_proximity', 'generations from the scope root to the element')],
  },
  {
    name: 'web_var_def',
    description: 'Every custom-property definition: a declaration `--x: …` in a rule or a style attribute, or an `@property --x` rule (def_uid = rule_uid). SPEC §3.4a.',
    columns: [id('def_uid'), id('name'), id('rule_uid'), id('attribute_uid'), id('element_uid'), id('stylesheet_uid')],
  },
  {
    name: 'web_var_visible',
    description: 'Page-independent: a var() use (the using declaration and its value reference) sees a definition when some page loads both (or the definition is a style attribute of a page that loads the use). A use no definition reaches: one row, def_uid NULL, reason no_definition_in_scope / fallback_only.',
    columns: [id('use_uid'), id('value_ref_uid'), id('name'), id('def_uid'), t('status'), t('reason')],
  },
  {
    name: 'web_var_scope',
    description: 'One row per (page, element styled by a rule using var(--name), name): `root_uid` the nearest ancestor-or-self styled by a rule defining --name (the inheritance root), status of that styles row; `root_exact_uid` the nearest EXACT root when the nearest is only conditional; NULL root with reason not_inherited / no_definition_in_scope.',
    columns: [id('page_uid'), id('element_uid'), id('name'), id('root_uid'), id('root_exact_uid'), t('status'), t('reason')],
  },
  { name: 'web_defines_var', description: 'declaration -> custom property it defines (page-independent).', columns: [id('declaration_uid'), id('name')] },
  { name: 'web_uses_var', description: 'var() value reference -> custom property name, with the declaration it sits in (page-independent).', columns: [id('value_ref_uid'), id('name'), id('declaration_uid')] },
  {
    name: 'web_keyframes_use',
    description: 'animation / animation-name (the declaration) -> @keyframes rule of that name (vendor-prefixed included) in a sheet the same page loads; unknown no_such_keyframes.',
    columns: [id('use_uid'), id('value_ref_uid'), id('name'), id('target_uid'), id('page_uid'), t('status'), t('reason')],
  },
  {
    name: 'web_font_use',
    description: 'font-family (the declaration) -> @font-face rule declaring the family (case-insensitive, quotes stripped) in a sheet the same page loads; unknown system_or_external_font.',
    columns: [id('use_uid'), id('value_ref_uid'), id('name'), id('target_uid'), id('page_uid'), t('status'), t('reason')],
  },
  {
    name: 'web_container_use',
    description: '@container <name> (the rule) -> the declarations (container-name / container) naming it in sheets the same page loads.',
    columns: [id('use_uid'), id('name'), id('target_uid'), id('page_uid'), t('status'), t('reason')],
  },
  {
    name: 'web_unknown',
    description: 'Every declared unknown that has no edge row of its own: orphan_sheet, fragment_no_host, no_static_carrier (a selector needing a class/id no element of the page carries), shadow_dom, selector_unparsed, implied_element, column_combinator (a selector undecidable on a page), parse_gap, duplicate_id, … with the node and page it concerns.',
    columns: [t('kind'), id('node_uid'), id('page_uid'), t('reason'), t('detail'), id('file'), i('line')],
  },
];

/** Views: the edges a reader expects by name that are a projection of a node table. */
export const WEB_VIEWS: readonly string[] = [
  `CREATE VIEW web_script AS SELECT uid, page_uid, element_uid, file, order_on_page AS ordinal, type_as_written, script_type, lower(script_kind) AS kind,
     attributes, src, resolved_file, body_start_line AS body_line, body_start_col AS body_col, body_end_line, body_end_col, body, body_bytes, body_lines, inline_index
     FROM web_scripts`,
  `CREATE VIEW web_handler AS SELECT uid, page_uid, element_uid, file, line, col, attr_as_written, event, modifiers, source_kind, code, code_bytes, tag, handler_index
     FROM web_handlers`,
  `CREATE VIEW web_event_handlers AS SELECT uid, element_uid, attr_as_written AS attribute_name,
     CASE source_kind WHEN 'on_attribute' THEN 'EVENT_ATTRIBUTE' WHEN 'javascript_url' THEN 'JAVASCRIPT_URL' ELSE 'TEMPLATE_EVENT' END AS handler_source,
     CASE WHEN source_kind = 'javascript_url' THEN NULL ELSE event END AS event_name, code AS raw_text FROM web_handlers`,
  // var(--x) per page: a use, every definition in scope on the page, and the inheritance status (SPEC §3.4, §3.4a). Not
  // materialized: it is the (use x def x page) set, quadratic on a large site; impact reads the stored tables.
  `CREATE VIEW web_var AS
   WITH RECURSIVE
   loads AS (SELECT DISTINCT page_uid, stylesheet_uid FROM web_loads WHERE stylesheet_uid IS NOT NULL),
   use_scope AS (
     SELECT u.value_ref_uid AS vref, u.declaration_uid AS use_uid, u.name, l.page_uid, d.rule_uid, NULL AS elem_uid
       FROM web_uses_var u JOIN web_declarations d ON d.uid = u.declaration_uid JOIN loads l ON l.stylesheet_uid = d.stylesheet_uid
      WHERE d.attribute_uid IS NULL
     UNION ALL
     SELECT u.value_ref_uid, u.declaration_uid, u.name, d.page_uid, NULL, d.element_uid
       FROM web_uses_var u JOIN web_declarations d ON d.uid = u.declaration_uid WHERE d.attribute_uid IS NOT NULL),
   def_scope AS (
     SELECT v.def_uid, v.name, l.page_uid, v.rule_uid, NULL AS elem_uid, (v.rule_uid = v.def_uid) AS is_property
       FROM web_var_def v JOIN loads l ON l.stylesheet_uid = v.stylesheet_uid WHERE v.attribute_uid IS NULL
     UNION ALL
     SELECT v.def_uid, v.name, d.page_uid, NULL, v.element_uid, 0
       FROM web_var_def v JOIN web_declarations d ON d.uid = v.def_uid WHERE v.attribute_uid IS NOT NULL),
   use_els AS (
     SELECT us.vref, us.page_uid, s.element_uid AS elem, MAX(CASE s.status WHEN 'match' THEN 2 ELSE 1 END) AS st
       FROM use_scope us JOIN web_styles s ON s.rule_uid = us.rule_uid AND s.page_uid = us.page_uid AND s.status != 'unknown'
      GROUP BY 1, 2, 3
     UNION ALL SELECT vref, page_uid, elem_uid, 2 FROM use_scope WHERE elem_uid IS NOT NULL),
   anc(vref, page_uid, st, a) AS (
     SELECT vref, page_uid, st, elem FROM use_els
     UNION SELECT anc.vref, anc.page_uid, anc.st, e.parent_uid FROM anc JOIN web_elements e ON e.uid = anc.a WHERE e.parent_uid IS NOT NULL),
   def_els AS (
     SELECT ds.def_uid, ds.page_uid, s.element_uid AS elem, MAX(CASE s.status WHEN 'match' THEN 2 ELSE 1 END) AS st
       FROM def_scope ds JOIN web_styles s ON s.rule_uid = ds.rule_uid AND s.page_uid = ds.page_uid AND s.status != 'unknown'
      GROUP BY 1, 2, 3
     UNION ALL SELECT def_uid, page_uid, elem_uid, 2 FROM def_scope WHERE elem_uid IS NOT NULL),
   pairs AS (
     SELECT us.vref, us.use_uid, us.name, us.page_uid, ds.def_uid, MAX(ds.is_property) AS is_property
       FROM use_scope us JOIN def_scope ds ON ds.name = us.name AND ds.page_uid = us.page_uid GROUP BY 1, 2, 3, 4, 5),
   best AS (
     SELECT p.vref, p.def_uid, p.page_uid, MAX(CASE WHEN a.st = 2 AND de.st = 2 THEN 2 ELSE 1 END) AS b
       FROM pairs p JOIN anc a ON a.vref = p.vref AND a.page_uid = p.page_uid
       JOIN def_els de ON de.def_uid = p.def_uid AND de.page_uid = p.page_uid AND de.elem = a.a
      GROUP BY 1, 2, 3)
   SELECT p.vref AS use, p.def_uid AS def, p.page_uid AS page, p.use_uid AS use_declaration, p.name,
          CASE WHEN p.is_property OR b.b = 2 THEN 'match' WHEN b.b = 1 THEN 'conditional' ELSE 'unknown' END AS status,
          CASE WHEN p.is_property OR b.b IS NOT NULL THEN NULL ELSE 'not_inherited' END AS reason
     FROM pairs p LEFT JOIN best b ON b.vref = p.vref AND b.def_uid = p.def_uid AND b.page_uid = p.page_uid
   UNION ALL
   SELECT DISTINCT us.vref, NULL, us.page_uid, us.use_uid, us.name, 'unknown',
          CASE WHEN vr.fallback_text IS NOT NULL THEN 'fallback_only' ELSE 'no_definition_in_scope' END
     FROM use_scope us JOIN web_value_refs vr ON vr.uid = us.vref
    WHERE NOT EXISTS (SELECT 1 FROM def_scope ds WHERE ds.name = us.name AND ds.page_uid = us.page_uid)`,
  `CREATE VIEW web_contains AS
     SELECT COALESCE(parent_uid, page_uid) AS parent_uid, uid AS child_uid, CASE WHEN parent_uid IS NULL THEN 'page' ELSE 'element' END AS parent_kind, page_uid
     FROM web_elements`,
  `CREATE VIEW web_inline_styles AS
     SELECT d.element_uid, d.page_uid, d.uid AS declaration_uid, d.property, d.value_text, d.is_important, d.file, d.line
     FROM web_declarations d WHERE d.attribute_uid IS NOT NULL`,
];
