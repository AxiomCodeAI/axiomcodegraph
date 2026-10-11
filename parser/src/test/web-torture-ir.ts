/**
 * The torture suite's view of one analyzer run: the sixteen relations as rows, indexed
 * by their keys, with the lookups the checks repeat. Nothing here interprets the IR —
 * that is the engine's job — it only follows link columns.
 */
import * as path from 'path';

export type Row = Record<string, string>;
export type Verdict = 'DEFECT' | 'GAP' | 'LIMIT';

export interface Check {
  name: string;
  verdict: Verdict;
  /** For a GAP or LIMIT: what would close it, or why nothing can. */
  note?: string;
  run: (ir: Ir, fail: (message: string) => void) => void;
}

export class Ir {
  readonly documents: Row[];
  readonly elements: Row[];
  readonly attributes: Row[];
  readonly classRefs: Row[];
  readonly references: Row[];
  readonly scripts: Row[];
  readonly handlerCalls: Row[];
  readonly htmlGaps: Row[];
  readonly stylesheets: Row[];
  readonly rules: Row[];
  readonly selectors: Row[];
  readonly parts: Row[];
  readonly declarations: Row[];
  readonly valueRefs: Row[];
  readonly comments: Row[];
  readonly cssGaps: Row[];
  readonly templateExpressions: Row[];
  readonly tables: Record<string, Row[]>;

  private readonly byKey = new Map<string, Row>();

  constructor(readonly root: string, tables: Record<string, Row[]>) {
    this.tables = tables;
    const t = (k: string): Row[] => tables[k] ?? [];
    this.documents = t('HTML_DOCUMENTS');
    this.elements = t('HTML_ELEMENTS');
    this.attributes = t('HTML_ATTRIBUTES');
    this.classRefs = t('HTML_CLASS_REFERENCES');
    this.references = t('HTML_REFERENCES');
    this.scripts = t('HTML_SCRIPTS');
    this.handlerCalls = t('HTML_HANDLER_CALLS');
    this.htmlGaps = t('HTML_PARSE_GAPS');
    this.stylesheets = t('CSS_STYLESHEETS');
    this.rules = t('CSS_RULES');
    this.selectors = t('CSS_SELECTORS');
    this.parts = t('CSS_SELECTOR_PARTS');
    this.declarations = t('CSS_DECLARATIONS');
    this.valueRefs = t('CSS_VALUE_REFERENCES');
    this.comments = t('CSS_COMMENTS');
    this.cssGaps = t('CSS_PARSE_GAPS');
    this.templateExpressions = t('HTML_TEMPLATE_EXPRESSIONS');
    for (const rows of Object.values(tables)) {
      for (const r of rows) {
        const key = Object.keys(r).find((c) => c.endsWith('UniqueHash'));
        if (key !== undefined) this.byKey.set(r[key]!, r);
      }
    }
  }

  /** The row a link column points at, or undefined for '' and for a dangling link. */
  row(hash: string | undefined): Row | undefined {
    return hash === undefined || hash === '' ? undefined : this.byKey.get(hash);
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  // ── documents and their rows ──────────────────────────────────────────────

  doc(rel: string): Row {
    const d = this.documents.find((x) => x['relativePath'] === rel);
    if (d === undefined) throw new Error(`no html_document for ${rel}`);
    return d;
  }

  /** Rows of a relation whose documentLinkHash is the page's. */
  ofDoc(rows: Row[], rel: string): Row[] {
    const key = this.doc(rel)['htmlDocumentUniqueHash'];
    return rows.filter((r) => (r['documentLinkHash'] ?? r['htmlDocumentLinkHash']) === key);
  }

  element(rel: string, pathSuffix: string): Row | undefined {
    return this.ofDoc(this.elements, rel).find((e) => e['path']!.endsWith(pathSuffix));
  }

  elementsAtLine(rel: string, line: number): Row[] {
    return this.ofDoc(this.elements, rel).filter((e) => Number(e['startLine']) === line);
  }

  attrsOf(element: Row): Row[] {
    return this.attributes.filter((a) => a['ownerElementLinkHash'] === element['htmlElementUniqueHash']);
  }

  attr(element: Row, name: string): Row | undefined {
    return this.attrsOf(element).find((a) => a['name'] === name);
  }

  classesAtLine(rel: string, line: number): string[] {
    return this.ofDoc(this.classRefs, rel).filter((c) => Number(c['startLine']) === line).map((c) => c['className']!);
  }

  refsAtLine(rel: string, line: number): Row[] {
    return this.ofDoc(this.references, rel).filter((r) => Number(r['startLine']) === line);
  }

  ref(rel: string, url: string, attributeName?: string): Row | undefined {
    return this.ofDoc(this.references, rel).find((r) => r['urlAsWritten'] === url && (attributeName === undefined || r['attributeName'] === attributeName));
  }

  handlersAtLine(rel: string, line: number): Row[] {
    return this.ofDoc(this.handlerCalls, rel).filter((h) => Number(h['startLine']) === line).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  // ── stylesheets and their rows ────────────────────────────────────────────

  /** A `.css` file by relative path, or a page's n-th `<style>` as `page.html#styleN`. */
  sheet(ref: string): Row {
    const hash = ref.indexOf('#');
    const s = hash < 0
      ? this.stylesheets.find((x) => x['relativePath'] === ref && x['sourceKind'] === 'FILE')
      : this.stylesheets.find((x) => x['relativePath'] === ref.slice(0, hash) && x['name']!.endsWith(ref.slice(hash)));
    if (s === undefined) throw new Error(`no css_stylesheet for ${ref}`);
    return s;
  }

  rulesOf(sheetRef: string): Row[] {
    const key = this.sheet(sheetRef)['cssStylesheetUniqueHash'];
    return this.rules.filter((r) => r['stylesheetLinkHash'] === key);
  }

  ruleAtLine(sheetRef: string, line: number, prelude?: string): Row | undefined {
    return this.rulesOf(sheetRef).find((r) => Number(r['startLine']) === line && (prelude === undefined || r['preludeText'] === prelude));
  }

  selectorsOf(rule: Row): Row[] {
    return this.selectors.filter((s) => s['ruleLinkHash'] === rule['cssRuleUniqueHash']).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  /** The one selector with this text in the sheet, searched by text alone. */
  selector(sheetRef: string, text: string): Row | undefined {
    const rules = new Set(this.rulesOf(sheetRef).map((r) => r['cssRuleUniqueHash']));
    return this.selectors.find((s) => rules.has(s['ruleLinkHash']!) && s['selectorText'] === text);
  }

  partsOf(selector: Row): Row[] {
    return this.parts.filter((p) => p['selectorLinkHash'] === selector['cssSelectorUniqueHash']).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  partsOfSheet(sheetRef: string): Row[] {
    const rules = new Set(this.rulesOf(sheetRef).map((r) => r['cssRuleUniqueHash']));
    return this.parts.filter((p) => rules.has(p['ruleLinkHash']!));
  }

  declsOf(rule: Row): Row[] {
    return this.declarations.filter((d) => d['ruleLinkHash'] === rule['cssRuleUniqueHash']).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  declsOfSheet(sheetRef: string): Row[] {
    const key = this.sheet(sheetRef)['cssStylesheetUniqueHash'];
    return this.declarations.filter((d) => d['stylesheetLinkHash'] === key);
  }

  declAtLine(sheetRef: string, line: number, property?: string): Row | undefined {
    return this.declsOfSheet(sheetRef).find((d) => Number(d['startLine']) === line && (property === undefined || d['property'] === property));
  }

  /** Declarations of a page's `style` attributes, by line. */
  styleAttrDeclsAtLine(rel: string, line: number): Row[] {
    const attrs = new Set(this.ofDoc(this.attributes, rel).filter((a) => a['attributeKind'] === 'STYLE').map((a) => a['htmlAttributeUniqueHash']));
    return this.declarations.filter((d) => attrs.has(d['htmlAttributeLinkHash']!) && Number(d['startLine']) === line).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  refsOfDecl(decl: Row): Row[] {
    return this.valueRefs.filter((v) => v['ownerDeclarationLinkHash'] === decl['cssDeclarationUniqueHash']).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  refsOfRule(rule: Row): Row[] {
    return this.valueRefs.filter((v) => v['ownerRuleLinkHash'] === rule['cssRuleUniqueHash']).sort((a, b) => Number(a['position']) - Number(b['position']));
  }

  valueRefsOfSheet(sheetRef: string, kind?: string): Row[] {
    const key = this.sheet(sheetRef)['cssStylesheetUniqueHash'];
    return this.valueRefs.filter((v) => v['stylesheetLinkHash'] === key && (kind === undefined || v['referenceKind'] === kind));
  }

  cssGapsOf(sheetRef: string): Row[] {
    const key = this.sheet(sheetRef)['cssStylesheetUniqueHash'];
    return this.cssGaps.filter((g) => g['stylesheetLinkHash'] === key);
  }
}

/** `a=b c=d` of the columns named, for a failure message. */
export function show(row: Row | undefined, ...cols: string[]): string {
  if (row === undefined) return '<no row>';
  return cols.map((c) => `${c}=${JSON.stringify(row[c] ?? '')}`).join(' ');
}
