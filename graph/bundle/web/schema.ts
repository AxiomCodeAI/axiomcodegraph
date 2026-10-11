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
    columns: [id('uid'), id('element_uid'), id('attribute_uid'), id('page_uid'), id('file'), id('tag'), t('attr_as_written'), id('event'), t('event_source', 'written | stimulus_default (a data-action descriptor with no event: Stimulus\'s default for the tag) | stimulus_default_unknown (no default for the tag; event NULL)'), t('modifiers'), t('source_kind'),
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
    description: 'One rule: a style rule or an at-rule. `rule_order` is its 1-based pre-order position in its sheet; `layer` the dotted cascade layer it sits in (empty: unlayered); `conditions` `usage` the best of its selectors\' usage (matched > conditional_only > unknown_only > unmatched_static > not_loaded; NULL without element selectors); the enclosing @media/@supports/@container/@scope/@starting-style/@document preludes, outermost first, joined by \' && \'; `in_keyframes` = 1 for a block inside @keyframes/@font-face/@page… (its selectors style no element).',
    columns: [id('uid'), id('stylesheet_uid'), id('parent_uid'), id('file'), i('line'), i('col'), i('end_line'), i('end_col'), t('rule_kind'), t('at_rule_name'), id('name'),
      t('prelude_text'), i('nesting_depth'), i('position'), i('rule_order'), t('layer'), t('conditions'), i('in_keyframes'), i('important_count'), t('usage')],
  },
  {
    name: 'web_selectors',
    description: 'One complex selector of a style rule. `decidability`: exact, conditional (a state pseudo-class or an at-rule condition), unknown (with `reason`), none (a keyframe offset). spec_* is the specificity after nesting is resolved. Per page (SPEC §3.5 [iter2] grain, §9.9): `pages_loading` pages whose loads reach its sheet, `pages_matched` pages with any styles row, `pages_unmatched` pages with none and no whole-selector unknown (the list: view web_selector_unmatched_pages), `unknown_reason` explains `usage`: for unmatched_static no_static_carrier (a required class/id has no static carrier on some page) or no_element_matches, for unknown_only the unknown reason (dynamic_class, shadow_dom…), NULL otherwise; `usage` matched | conditional_only | unknown_only | unmatched_static (loaded, no styles row anywhere) | not_loaded (NULL for a keyframe offset). Never "dead": classes added at run time are outside this layer.',
    columns: [id('uid'), id('rule_uid'), id('stylesheet_uid'), id('file'), i('line'), i('col'), i('position'), id('selector_text'), i('spec_a'), i('spec_b'), i('spec_c'),
      i('compound_count'), i('has_nesting'), i('has_pseudo_element'), t('decidability'), t('reason'), i('pages_loading'), i('pages_matched'), i('elements_matched'), i('pages_unmatched'), t('unknown_reason'), t('usage')],
  },
  {
    name: 'web_selector_required',
    description: 'The class and id tokens a selector REQUIRES of its subject chain (nesting resolved; never inside :not()/:is() alternatives), written for every selector that, on some page, required a token no element there carries: what view web_selector_unmatched_pages tests against each loading page\'s carriers.',
    columns: [id('selector_uid'), t('kind', 'class | id'), id('token')],
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
    columns: [id('uid'), t('lang'), t('gap_kind'), t('detail'), id('owner_uid', 'page (html) or sheet (css)'), id('related_uid', 'the element (html) or rule (css) it covers'), id('element_uid', 'the element an html gap covers (= related_uid for html)'), id('file'), i('line'), i('col'), i('end_line'), i('end_col')],
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
    description: 'Page-independent: a var() use (the using declaration and its value reference) sees the definitions of its name held by an OWNER (`def_owner_kind` sheet: a stylesheet some page loads with the use; page: style attributes of a page that loads the use) — one row per (use, owner), `defs` = how many definitions of the name that owner holds, `def_uid` set when it is exactly one (V1-22 grain; the per-definition rows are the view web_var_visible_defs). A use no definition reaches: one row, def_owner_uid NULL, reason no_definition_in_scope / fallback_only.',
    columns: [id('use_uid'), id('value_ref_uid'), id('name'), id('def_owner_uid'), t('def_owner_kind'), i('defs'), id('def_uid'), t('status'), t('reason')],
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
  // ── [iter2] SPEC §9 conversion layer ──────────────────────────────────────
  {
    name: 'web_components',
    description: 'A shared structure (component candidate, SPEC §9.1): every written element (not inert, not html/head/body) with one signature, at a `level` — exact (tag, static class tokens, attribute names, children) or shape (tag and children only) — kept when it occurs >= 2 times with >= 3 elements, and maximal (a group only ever found as the direct part of one other group is folded into it). `display` <tag>.<first 3 classes sorted> (#n when shared); `size` elements in one occurrence; `parent_component_uid` the group whose occurrences contain every occurrence of this one; `rules_styling_root` rules with a styles row on the first occurrence.',
    columns: [id('uid'), t('level'), t('signature'), t('root_tag'), t('root_classes'), id('display'), i('size'), i('occurrences'), i('pages'), id('parent_component_uid'), i('slot_count'), i('rules_styling_root')],
  },
  {
    name: 'web_component_occurrences',
    description: 'One occurrence (root element) of a component candidate.',
    columns: [id('component_uid'), id('element_uid'), id('page_uid'), id('file'), i('line'), i('col')],
  },
  {
    name: 'web_component_slots',
    description: 'What varies between the aligned occurrences of a component (or the items of a repeat, keyed by its uid): `path` child-index path from the root (\'\' = the root, e.g. 0/2/1), `kind` text | attr:<name> | class (shape level), distinct_values and up to 5 samples (JSON).',
    columns: [id('component_uid'), t('path'), t('kind'), t('attribute_name'), i('distinct_values'), t('samples')],
  },
  {
    name: 'web_repeats',
    description: 'A repeated list (SPEC §9.8): a maximal run of >= 3 consecutive element siblings of one shape, >= 2 elements per item. `uniform` = every item also has one exact signature; slots in web_component_slots under this uid.',
    columns: [id('uid'), id('parent_element_uid'), id('page_uid'), id('first_element_uid'), i('start_position'), i('count'), t('item_tag'), t('item_classes'), i('item_size'), i('uniform'), id('component_uid'), i('slot_count')],
  },
  {
    name: 'web_computed',
    description: 'The cascade winner per (element, pseudo-element, written property) with >= 1 contender (SPEC §9.2): contenders are the declarations of the property in every rule with a styles row for the element and pseudo-element, plus its style attribute, sorted by importance, origin/layer, specificity, sheet order, rule order, position. `winner_status` match | conditional_only (no exact contender) | unknown (an unknown contender sorts above the winner) | shorthand_override (a shorthand declaration sorts above this longhand\'s winner: `override_decl_uid`; values are not expanded, LIMIT L5). Inherited and initial values are not filled (L6). `winner_key` is the sort key the view web_cascade compares against.',
    columns: [id('element_uid'), id('page_uid'), t('pseudo'), id('property'), id('winner_decl_uid'), t('winner_origin'), t('winner_status'), t('value_text'), i('important'), i('contenders'), i('conditional_overrides'), id('override_decl_uid'), t('winner_key')],
  },
  {
    name: 'web_tokens',
    description: 'A theme token (SPEC §9.3): kind color | font_family | font_size | spacing | radius | shadow | z_index | custom_property and its normalised value; `uses` declarations holding it, `project_uses` those outside vendor sheets and minified twins, `sheets`, `rules`, `vars` custom properties whose value holds it.',
    columns: [id('uid'), t('kind'), id('value'), i('uses'), i('project_uses'), i('sheets'), i('rules'), t('vars')],
  },
  { name: 'web_token_uses', description: 'token -> declaration holding it.', columns: [id('token_uid'), id('declaration_uid')] },
  {
    name: 'web_breakpoints',
    description: 'A @media prelude or a media attribute, normalised (SPEC §9.4): lower-cased, whitespace collapsed, no space inside parentheses or around : and ,. `min_px`/`max_px` from min-width/max-width/width ranges (em/rem x 16, `unit` as written), other features in `features`; counts of rules under it, sheets, elements styled through it and pages.',
    columns: [id('uid'), id('media'), i('min_px'), i('max_px'), t('unit'), t('features'), i('rules'), i('sheets'), i('elements'), i('pages')],
  },
  { name: 'web_rule_breakpoints', description: 'rule -> breakpoint it sits under (depth 1 = a direct child of the @media, 0 = a rule of a sheet loaded with that media).', columns: [id('rule_uid'), id('breakpoint_uid'), i('depth')] },
  {
    name: 'web_forms',
    description: 'A <form> (SPEC §9.5): action as written and the page it resolves to, method (lower-cased, default get), enctype, controls it owns.',
    columns: [id('element_uid'), id('page_uid'), t('action'), id('action_resolved_page'), t('method'), t('enctype'), i('controls')],
  },
  {
    name: 'web_form_controls',
    description: 'input, select, textarea, button, contenteditable (SPEC §9.5): its form owner (form attribute, else the nearest ancestor form), type (input default text, button default submit), the constraint attributes, and its label per the HTML spec: `label_via` for | wrap | aria-labelledby | aria-label | title | none.',
    columns: [id('element_uid'), id('page_uid'), id('form_uid'), t('tag'), t('type'), id('name'), id('id'), i('required'), t('pattern'), t('min'), t('max'), t('minlength'), t('maxlength'),
      t('step'), t('placeholder'), t('value'), i('checked'), i('disabled'), i('multiple'), t('autocomplete'), id('label_uid'), t('label_via'), t('label_text')],
  },
  {
    name: 'web_icon_classes',
    description: 'A class C is an icon class (SPEC §9.6) when a selector of ONE compound whose only class is C, with ::before/::after, belongs to a rule declaring `content` with a string of <= 2 characters or one CSS escape. `font_family` as written: declared in that rule, or in a one-class rule for a class the same elements carry.',
    columns: [id('class_name'), id('rule_uid'), t('content'), t('font_family'), i('used_elements')],
  },
  {
    name: 'web_font_faces',
    description: 'An @font-face: family, the files its src names, weight, style, and the rules using the family.',
    columns: [id('rule_uid'), id('family'), t('src_files'), t('weight'), t('style'), i('used_rules')],
  },
  {
    name: 'web_outline',
    description: 'Landmarks and headings of a page in document order (SPEC §9.7): header, nav, main, aside, footer, search, section/article (region when named), a named form, ARIA landmark roles; h1-h6 and role=heading with aria-level. `parent_outline_uid` the nearest ancestor outline row.',
    columns: [id('uid'), id('element_uid'), id('page_uid'), t('kind'), t('name'), i('level'), t('label'), t('text'), id('parent_outline_uid'), i('ordinal')],
  },
  {
    name: 'web_classes',
    description: 'A class token carried by an element (SPEC §9.9): elements and pages carrying it, selectors naming it, those of them with any styles row, `styled` = some selector naming it has a styles row on an element carrying it, `icon` = an icon class. Never "dead": classes added at run time are outside this layer.',
    columns: [id('class_name'), i('elements'), i('pages'), i('selectors_naming'), i('selectors_matching'), i('styled'), i('icon')],
  },
  {
    name: 'web_unknown',
    description: 'Every declared unknown that has no edge row of its own: orphan_sheet, fragment_no_host, no_static_carrier (a selector needing a class/id no element of the page carries), shadow_dom, selector_unparsed, implied_element, column_combinator (a selector undecidable on a page), parse_gap, duplicate_id, … with the node and page it concerns.',
    columns: [t('kind'), id('node_uid'), id('page_uid'), t('reason'), t('detail'), id('file'), i('line')],
  },
];

/** Views: the edges a reader expects by name that are a projection of a node table. */
/** run after the indexes: values that need every table written (web_rules.usage from its selectors) */
export const WEB_FINALIZE: readonly string[] = [
  `UPDATE web_rules SET usage = (SELECT CASE min(CASE s.usage WHEN 'matched' THEN 1 WHEN 'conditional_only' THEN 2 WHEN 'unknown_only' THEN 3
     WHEN 'unmatched_static' THEN 4 WHEN 'not_loaded' THEN 5 END) WHEN 1 THEN 'matched' WHEN 2 THEN 'conditional_only' WHEN 3 THEN 'unknown_only'
     WHEN 4 THEN 'unmatched_static' WHEN 5 THEN 'not_loaded' END FROM web_selectors s WHERE s.rule_uid = web_rules.uid)`,
];

export const WEB_VIEWS: readonly string[] = [
  // SPEC §9.2: every contender of a web_computed row with its outcome and why it lost (keys as web_computed.winner_key)
  `CREATE VIEW web_cascade AS
   WITH c AS (
     SELECT s.element_uid AS element, COALESCE(s.pseudo_element, '') AS pseudo, lower(d.property) AS property, d.uid AS decl,
            max(printf('%d|%010d|%04d|%04d|%04d|%06d|%07d|%05d', d.is_important, CASE WHEN d.is_important = 1 THEN 1000000000 - s.layer_rank ELSE s.layer_rank END,
                s.spec_a, s.spec_b, s.spec_c, s.sheet_order, s.rule_order, COALESCE(d.position, 0))) AS k,
            min(CASE s.status WHEN 'match' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END) AS st, max(s.conditions) AS conditions
       FROM web_styles s JOIN web_declarations d ON d.rule_uid = s.rule_uid
      GROUP BY 1, 2, 3, 4
     UNION ALL
     SELECT d.element_uid, '', lower(d.property), d.uid, printf('%d|%010d|%04d|%04d|%04d|%06d|%07d|%05d', d.is_important, 2000000000, 0, 0, 0, 0, 0, COALESCE(d.position, 0)), 0, NULL
       FROM web_declarations d WHERE d.attribute_uid IS NOT NULL AND d.element_uid IS NOT NULL)
   SELECT c.element, NULLIF(c.pseudo, '') AS pseudo, c.property, c.decl,
          ROW_NUMBER() OVER (PARTITION BY c.element, c.pseudo, c.property ORDER BY c.k DESC) AS rank,
          CASE WHEN c.decl = w.winner_decl_uid THEN 'won' WHEN c.k > w.winner_key THEN 'conditional' ELSE 'lost' END AS outcome,
          CASE WHEN c.decl = w.winner_decl_uid OR c.k > w.winner_key THEN NULL
               WHEN substr(c.k, 1, 1) != substr(w.winner_key, 1, 1) THEN 'importance'
               WHEN substr(c.k, 3, 10) != substr(w.winner_key, 3, 10) THEN
                 CASE WHEN substr(c.k, 3, 10) = '2000000000' OR substr(w.winner_key, 3, 10) = '2000000000' THEN 'origin' ELSE 'layer' END
               WHEN substr(c.k, 14, 14) != substr(w.winner_key, 14, 14) THEN 'specificity'
               ELSE 'source_order' END AS lost_reason,
          c.conditions, CASE c.st WHEN 0 THEN 'match' WHEN 1 THEN 'conditional' ELSE 'unknown' END AS status
     FROM c JOIN web_computed w ON w.element_uid = c.element AND COALESCE(w.pseudo, '') = c.pseudo AND w.property = c.property`,
  // SPEC §9.10: the per-page inventory, aggregates of existing tables
  `CREATE VIEW web_page_inventory AS SELECT p.uid AS page, p.file,
     (SELECT group_concat(f, ' ') FROM (SELECT st.file AS f FROM web_loads l JOIN web_stylesheets st ON st.uid = l.stylesheet_uid WHERE l.page_uid = p.uid ORDER BY l.load_order)) AS sheets_in_order,
     (SELECT count(*) FROM web_stylesheets st JOIN web_elements e ON e.uid = st.owner_element_uid WHERE e.page_uid = p.uid) AS style_elements,
     (SELECT count(DISTINCT attribute_uid) FROM web_declarations d WHERE d.page_uid = p.uid AND d.attribute_uid IS NOT NULL) AS inline_style_attrs,
     (SELECT count(*) FROM web_scripts s WHERE s.page_uid = p.uid AND s.script_kind != 'INLINE') AS scripts_external,
     (SELECT count(*) FROM web_scripts s WHERE s.page_uid = p.uid AND s.script_kind = 'INLINE') AS scripts_inline,
     (SELECT group_concat(ev || ':' || n, ' ') FROM (SELECT COALESCE(event, '?') AS ev, count(*) AS n FROM web_handlers h WHERE h.page_uid = p.uid GROUP BY 1)) AS handlers_by_event,
     (SELECT group_concat(dl || ':' || n, ' ') FROM (SELECT dialect AS dl, count(*) AS n FROM web_template_exprs t WHERE t.page_uid = p.uid GROUP BY 1)) AS template_directives_by_dialect,
     (SELECT count(*) FROM web_forms f WHERE f.page_uid = p.uid) AS forms,
     (SELECT count(*) FROM web_form_controls c WHERE c.page_uid = p.uid) AS controls,
     (SELECT count(*) FROM web_outline o WHERE o.page_uid = p.uid AND o.kind = 'landmark') AS landmarks,
     (SELECT count(DISTINCT component_uid) FROM web_component_occurrences o WHERE o.page_uid = p.uid) AS components,
     (SELECT count(*) FROM web_repeats r WHERE r.page_uid = p.uid) AS repeats,
     (SELECT count(DISTINCT rb.breakpoint_uid) FROM web_rule_breakpoints rb JOIN web_styles s ON s.rule_uid = rb.rule_uid WHERE s.page_uid = p.uid) AS breakpoints
     FROM web_pages p`,
  // SPEC §3.5 [iter2]: the pages behind web_selectors.pages_unmatched — pages loading the selector's sheet with no styles row
  // for it and no whole-selector unknown row
  `CREATE VIEW web_selector_unmatched_pages AS SELECT DISTINCT s.uid AS selector_uid, s.selector_text, s.file AS sheet_file, s.line, l.page_uid,
     p.file AS page_file, 'no_static_carrier' AS unknown_reason
     FROM web_selectors s JOIN web_loads l ON l.stylesheet_uid = s.stylesheet_uid JOIN web_pages p ON p.uid = l.page_uid
     WHERE EXISTS (SELECT 1 FROM web_selector_required r0 WHERE r0.selector_uid = s.uid)
       AND NOT EXISTS (SELECT 1 FROM web_styles w WHERE w.selector_uid = s.uid AND w.page_uid = l.page_uid)
       AND NOT EXISTS (SELECT 1 FROM web_unknown k WHERE k.node_uid = s.uid AND k.page_uid = l.page_uid)
       AND EXISTS (SELECT 1 FROM web_selector_required q WHERE q.selector_uid = s.uid AND NOT EXISTS (
         SELECT 1 FROM web_elements e WHERE e.page_uid = l.page_uid AND (e.inert IS NULL OR e.inert != 'iframe_text') AND (
           (q.kind = 'id' AND (e.html_id = q.token OR (p.quirks = 1 AND lower(e.html_id) = lower(q.token))))
           OR (q.kind = 'class' AND EXISTS (SELECT 1 FROM web_class_tokens t WHERE t.element_uid = e.uid
                 AND (t.class_name = q.token OR (p.quirks = 1 AND lower(t.class_name) = lower(q.token))))))))`,
  `CREATE VIEW web_script AS SELECT uid, page_uid, element_uid, file, order_on_page AS ordinal, type_as_written, script_type, lower(script_kind) AS kind,
     attributes, src, resolved_file, body_start_line AS body_line, body_start_col AS body_col, body_end_line, body_end_col, body, body_bytes, body_lines, inline_index
     FROM web_scripts`,
  `CREATE VIEW web_handler AS SELECT uid, page_uid, element_uid, file, line, col, attr_as_written, event, event_source, modifiers, source_kind, code, code_bytes, tag, handler_index
     FROM web_handlers`,
  `CREATE VIEW web_event_handlers AS SELECT uid, element_uid, attr_as_written AS attribute_name,
     CASE source_kind WHEN 'on_attribute' THEN 'EVENT_ATTRIBUTE' WHEN 'javascript_url' THEN 'JAVASCRIPT_URL' ELSE 'TEMPLATE_EVENT' END AS handler_source,
     CASE WHEN source_kind = 'javascript_url' THEN NULL ELSE event END AS event_name, code AS raw_text FROM web_handlers`,
  // var(--x) per page: a use, every definition in scope on the page, and the inheritance status (SPEC §3.4, §3.4a). Not
  // materialized: it is the (use x def x page) set, quadratic on a large site; impact reads the stored tables.
  // the per-definition visibility (lossless expansion of web_var_visible's owner grain)
  `CREATE VIEW web_var_visible_defs AS
     SELECT v.use_uid, v.value_ref_uid, v.name, d.def_uid, v.status, v.reason
       FROM web_var_visible v JOIN web_var_def d ON d.name = v.name AND v.def_owner_kind = 'sheet' AND d.attribute_uid IS NULL AND d.stylesheet_uid = v.def_owner_uid
     UNION ALL
     SELECT v.use_uid, v.value_ref_uid, v.name, d.def_uid, v.status, v.reason
       FROM web_var_visible v JOIN web_var_def d ON d.name = v.name AND v.def_owner_kind = 'page' AND d.attribute_uid IS NOT NULL
       JOIN web_declarations x ON x.uid = d.def_uid AND x.page_uid = v.def_owner_uid
     UNION ALL
     SELECT use_uid, value_ref_uid, name, NULL, status, reason FROM web_var_visible WHERE def_owner_uid IS NULL`,
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
