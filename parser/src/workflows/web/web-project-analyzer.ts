import * as fs from 'fs/promises';
import * as path from 'path';

import { CssStylesheet } from '@/analysis-types/css/CssStylesheet';
import { WebRow } from '@/analysis-types/web/web-row';
import {
  ANALYSIS_OUTPUT_DIR,
  EXCLUDED_DIRS,
  LARGE_FILE_BYTE_THRESHOLD,
  LARGE_FILE_LINE_THRESHOLD,
} from '@/constants/consts';
import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  CSS_EXTENSIONS,
  HTML_EXTENSIONS,
  WEB_CSV_CHUNK_SIZE,
  WEB_CSV_FILES,
  WEB_MINIFIED_LINE_LENGTH_THRESHOLD,
  WEB_MINIFIED_NAME_PATTERN,
} from '@/constants/web-constants';
import { CssSourceProvenance, CssStylesheetSource } from '@/enums/css/CssStylesheetSource';
import { SkippedFileReason } from '@/enums/SkippedFileReason';
import { CssExtraction, CssParser } from '@/parsers/css/css-parser';
import { HtmlParser } from '@/parsers/html/html-parser';
import { ProjectInfo } from '@/types/ProjectInfo';
import { EntityUtils } from '@/utils/entity-utils';
import { groupOwnedFiles, resolveFileOwners } from '@/utils/file-ownership';
import { isGeneratedOutputDirectory } from '@/utils/generated-output';
import { isGitIgnoredDir } from '@/utils/git-ignored';
import { LineIndex } from '@/utils/web/line-index';

/**
 * THE WEB WALK'S OWN SKIP LIST (#1909). `EXCLUDED_DIRS` is the source walks' list, and for a script front end
 * `dist/`, `build/` and `out/` are a build's copy of the source beside it. For a site they are often the site:
 * a template ships its compiled stylesheet in `dist/css/` and every page links it, so skipping the directory by
 * name left the project's own main stylesheet unread while the page's <link> resolved to it — every selector
 * match through it missing. Pages and stylesheets under those names are read; a generated documentation tree
 * (javadoc, Dokka) and a git-ignored directory are still skipped below, and `target/` (a JVM build's copy of
 * resources) and virtual environments stay skipped by name.
 */
const WEB_EXCLUDED_DIRS: ReadonlySet<string> = new Set([...EXCLUDED_DIRS].filter((d) => d !== 'dist' && d !== 'build' && d !== 'out'));

interface SkippedFile {
  filePath: string;
  baseMservPath: string;
  serviceVersionHash: string;
  reason: SkippedFileReason;
  uniqueFileHash: string;
}

/** What one run produced, for the caller's report. */
export interface WebAnalysisSummary {
  htmlFilesSeen: number;
  cssFilesSeen: number;
  filesAnalysed: number;
  filesSkipped: number;
  counts: Record<string, number>;
}

/**
 * The web front end's workflow: every `.html` and `.css` file under every scan target,
 * attributed to the most specific project that contains it, read once, and written as
 * sixteen relations plus two skip reports.
 *
 * ## One analyzer for two languages
 *
 * A page's `<style>` elements and `style` attributes are CSS, and their rows go in the
 * CSS relations beside those of `.css` files. Two analyzers writing one relation would
 * overwrite each other (the failure `extractProject` documents for TypeScript), so HTML
 * and CSS are one workflow with one set of writers.
 *
 * ## File-type, not project-type
 *
 * Neither language has a project shape: a page sits in a Java resources folder, a Django
 * templates directory and a Vite root alike. So, like the XML and YAML analyzers, this one
 * walks every scan target rather than a per-language project list. A generated
 * documentation tree (javadoc, Dokka) is skipped the way the JavaScript walk skips it:
 * its pages are a build's output, not the project's.
 */
export class WebProjectAnalyzer {
  private readonly html: HtmlParser;
  private readonly css: CssParser;
  private readonly outputDir: string;

  private readonly rows: Record<keyof typeof WEB_CSV_FILES, WebRow[]> = {
    HTML_DOCUMENTS: [], HTML_ELEMENTS: [], HTML_ATTRIBUTES: [], HTML_CLASS_REFERENCES: [], HTML_REFERENCES: [],
    HTML_SCRIPTS: [], HTML_HANDLER_CALLS: [], HTML_TEMPLATE_EXPRESSIONS: [], HTML_PARSE_GAPS: [], CSS_STYLESHEETS: [], CSS_RULES: [],
    CSS_SELECTORS: [], CSS_SELECTOR_PARTS: [], CSS_DECLARATIONS: [], CSS_VALUE_REFERENCES: [], CSS_COMMENTS: [],
    CSS_PARSE_GAPS: [], SKIPPED_HTML_FILES: [], SKIPPED_CSS_FILES: [],
  };
  private readonly skippedHtml: SkippedFile[] = [];
  private readonly skippedCss: SkippedFile[] = [];
  private htmlSeen = 0;
  private cssSeen = 0;
  private analysed = 0;

  constructor(outputDir?: string) {
    this.css = new CssParser();
    this.html = new HtmlParser(this.css);
    this.outputDir = outputDir ?? ANALYSIS_OUTPUT_DIR;
  }

  /**
   * Analyzes every HTML and CSS file under the scan targets.
   *
   * @param projects Overlapping scan targets: the repository root and every project found beneath it.
   * @param serviceVersionLink The version to stamp on every row, UNHASHED; hashed here as every analyzer does.
   */
  async analyzeWebFiles(projects: ProjectInfo[], serviceVersionLink: string): Promise<WebAnalysisSummary> {
    const startTime = Date.now();
    const serviceVersionHash = EntityUtils.generateEntityHash(ENTITY_IDENTIFIERS.SERVICE_VERSION, serviceVersionLink);
    await fs.mkdir(this.outputDir, { recursive: true });

    const owners = await resolveFileOwners(projects, (root) => this.findWebFiles(root));
    for (const [project, files] of groupOwnedFiles(owners)) {
      await this.analyzeProject(project, files.sort(), serviceVersionHash);
    }

    await this.exportAll();

    const counts: Record<string, number> = {};
    for (const [key, rows] of Object.entries(this.rows)) {
      counts[WEB_CSV_FILES[key as keyof typeof WEB_CSV_FILES]] = rows.length;
    }
    const seconds = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n📊 Total HTML documents extracted: ${this.rows.HTML_DOCUMENTS.length}`);
    console.log(`📊 Total HTML elements extracted: ${this.rows.HTML_ELEMENTS.length}`);
    console.log(`📊 Total HTML references extracted: ${this.rows.HTML_REFERENCES.length}`);
    console.log(`📊 Total CSS stylesheets extracted: ${this.rows.CSS_STYLESHEETS.length}`);
    console.log(`📊 Total CSS rules extracted: ${this.rows.CSS_RULES.length}`);
    console.log(`📊 Total CSS declarations extracted: ${this.rows.CSS_DECLARATIONS.length}`);
    if (this.skippedHtml.length + this.skippedCss.length > 0) {
      console.log(`   ⏭  ${this.skippedHtml.length + this.skippedCss.length} file(s) skipped — see the skipped-files reports`);
    }
    console.log(`⏱️  HTML/CSS analysis completed in ${seconds}s`);
    return {
      htmlFilesSeen: this.htmlSeen,
      cssFilesSeen: this.cssSeen,
      filesAnalysed: this.analysed,
      filesSkipped: this.skippedHtml.length + this.skippedCss.length,
      counts,
    };
  }

  private async analyzeProject(project: ProjectInfo, files: ReadonlyArray<string>, serviceVersionHash: string): Promise<void> {
    if (files.length === 0) {
      return;
    }
    const htmlFiles = files.filter((f) => isHtmlFile(f));
    const cssFiles = files.filter((f) => isCssFile(f));
    this.htmlSeen += htmlFiles.length;
    this.cssSeen += cssFiles.length;
    console.log(`\n📦 HTML/CSS in: ${project.name}`);
    console.log(`   🔍 Found ${htmlFiles.length} HTML and ${cssFiles.length} CSS file(s)`);

    for (const filePath of htmlFiles) {
      const content = await this.readOrSkip(filePath, project, serviceVersionHash, this.skippedHtml);
      if (content === undefined) {
        continue;
      }
      try {
        const x = this.html.parse(content, filePath, project.path, serviceVersionHash);
        // Committed only once the whole file has parsed, and appended in a loop: `push(...rows)`
        // passes every row as an argument and overflows the stack past ~100k of them, which on
        // a generated page threw AFTER half the relations were already extended — rows of a
        // file then recorded as skipped. A loop cannot throw, so the commit is all or nothing.
        this.rows.HTML_DOCUMENTS.push(x.document);
        append(this.rows.HTML_ELEMENTS, x.elements);
        append(this.rows.HTML_ATTRIBUTES, x.attributes);
        append(this.rows.HTML_CLASS_REFERENCES, x.classReferences);
        append(this.rows.HTML_REFERENCES, x.references);
        append(this.rows.HTML_SCRIPTS, x.scripts);
        append(this.rows.HTML_HANDLER_CALLS, x.handlerCalls);
        append(this.rows.HTML_TEMPLATE_EXPRESSIONS, x.templateExpressions);
        append(this.rows.HTML_PARSE_GAPS, x.parseGaps);
        append(this.rows.CSS_STYLESHEETS, x.stylesheets);
        this.collectCss(x.css);
        this.analysed += 1;
      } catch (error) {
        this.recordExtractionError(filePath, project, serviceVersionHash, this.skippedHtml, error);
      }
    }

    for (const filePath of cssFiles) {
      const content = await this.readOrSkip(filePath, project, serviceVersionHash, this.skippedCss);
      if (content === undefined) {
        continue;
      }
      try {
        const lines = new LineIndex(content);
        const fileName = path.basename(filePath);
        const sheet = new CssStylesheet({
          name: fileName.replace(/\.[^.]+$/, ''),
          fileName,
          filePath,
          baseMservPath: project.path,
          relativePath: path.relative(project.path, filePath).split(path.sep).join('/'),
          sourceKind: CssStylesheetSource.FILE,
          sourceProvenance: WEB_MINIFIED_NAME_PATTERN.test(fileName) || lines.longestLine > WEB_MINIFIED_LINE_LENGTH_THRESHOLD
            ? CssSourceProvenance.MINIFIED : CssSourceProvenance.PROJECT,
          ownerHtmlElementLinkHash: '',
          htmlDocumentLinkHash: '',
          startLine: 1,
          startColumn: 1,
          endLine: Math.max(1, lines.lineCount),
          serviceVersionLinkHash: serviceVersionHash,
        });
        const x = this.css.parseStylesheet(content, {
          stylesheet: sheet, line: 1, column: 1, filePath, projectRoot: project.path,
          serviceVersionLinkHash: serviceVersionHash,
        });
        this.rows.CSS_STYLESHEETS.push(sheet);
        this.collectCss(x);
        this.analysed += 1;
      } catch (error) {
        this.recordExtractionError(filePath, project, serviceVersionHash, this.skippedCss, error);
      }
    }
  }

  private collectCss(x: CssExtraction): void {
    append(this.rows.CSS_RULES, x.rules);
    append(this.rows.CSS_SELECTORS, x.selectors);
    append(this.rows.CSS_SELECTOR_PARTS, x.selectorParts);
    append(this.rows.CSS_DECLARATIONS, x.declarations);
    append(this.rows.CSS_VALUE_REFERENCES, x.valueReferences);
    append(this.rows.CSS_COMMENTS, x.comments);
    append(this.rows.CSS_PARSE_GAPS, x.parseGaps);
  }

  /**
   * The file's text, or `undefined` with a skip row recorded. The guards are the XML
   * analyzer's: empty, then BYTES before lines (a minified file is megabytes on one line),
   * then the line count.
   */
  private async readOrSkip(filePath: string, project: ProjectInfo, serviceVersionHash: string, skipped: SkippedFile[]): Promise<string | undefined> {
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error(`   ❌ Error reading ${filePath}:`, error);
      this.skip(filePath, project, serviceVersionHash, SkippedFileReason.READ_ERROR, skipped);
      return undefined;
    }
    if (content.trim().length === 0) {
      this.skip(filePath, project, serviceVersionHash, SkippedFileReason.EMPTY_CONTENT, skipped);
      return undefined;
    }
    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > LARGE_FILE_BYTE_THRESHOLD) {
      console.log(`   ⏭️  Skipping very large file (${byteLength} bytes): ${filePath}`);
      this.skip(filePath, project, serviceVersionHash, SkippedFileReason.FILE_TOO_LARGE, skipped);
      return undefined;
    }
    const lineCount = content.split('\n').length;
    if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
      console.log(`   ⏭️  Skipping very large file (${lineCount} lines): ${filePath}`);
      this.skip(filePath, project, serviceVersionHash, SkippedFileReason.FILE_TOO_LARGE, skipped);
      return undefined;
    }
    // A UTF-8 byte-order mark is not markup; the grammar would keep it as text before the doctype.
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  }

  private recordExtractionError(filePath: string, project: ProjectInfo, serviceVersionHash: string, skipped: SkippedFile[], error: unknown): void {
    // EXTRACTION_ERROR, not READ_ERROR: the environment did not fail, the parser did.
    console.error(`   ❌ Error parsing ${filePath}:`, error);
    this.skip(filePath, project, serviceVersionHash, SkippedFileReason.EXTRACTION_ERROR, skipped);
  }

  private skip(filePath: string, project: ProjectInfo, serviceVersionHash: string, reason: SkippedFileReason, skipped: SkippedFile[]): void {
    const uniqueFileHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.SKIPPED_FILE,
      `${filePath}||${project.path}||${serviceVersionHash}||${reason}`
    );
    skipped.push({ filePath, baseMservPath: project.path, serviceVersionHash, reason, uniqueFileHash });
  }

  // ── the walk ──────────────────────────────────────────────────────────────

  private async findWebFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    await this.scan(root, files);
    return files;
  }

  private async scan(dirPath: string, files: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (WEB_EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        if (isGitIgnoredDir(path.join(dirPath, entry.name)) || isGeneratedOutputDirectory(dirPath, entry.name)) {
          continue;
        }
        await this.scan(path.join(dirPath, entry.name), files);
      } else if (entry.isFile() && (isHtmlFile(entry.name) || isCssFile(entry.name))) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }

  // ── export ────────────────────────────────────────────────────────────────

  private async exportAll(): Promise<void> {
    for (const [key, filename] of Object.entries(WEB_CSV_FILES) as [keyof typeof WEB_CSV_FILES, string][]) {
      if (key === 'SKIPPED_HTML_FILES' || key === 'SKIPPED_CSS_FILES') {
        continue;
      }
      await this.exportRows(this.rows[key], filename);
    }
    await this.exportSkipped(this.skippedHtml, WEB_CSV_FILES.SKIPPED_HTML_FILES);
    await this.exportSkipped(this.skippedCss, WEB_CSV_FILES.SKIPPED_CSS_FILES);
  }

  /**
   * One relation, in chunks. A relation with no rows is NOT written: the other file-type
   * analyzers (XML, YAML) leave an empty relation absent, and the engine stages an absent
   * mapped file as an empty one, so presence carries no information here.
   */
  private async exportRows(rows: readonly WebRow[], filename: string): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const outputPath = await this.writeAtomically(filename, async (handle) => {
      await handle.write(rows[0]!.getCsvHeader() + '\n', null, 'utf-8');
      for (let i = 0; i < rows.length; i += WEB_CSV_CHUNK_SIZE) {
        await handle.write(rows.slice(i, i + WEB_CSV_CHUNK_SIZE).map((row) => row.toCsv()).join('\n') + '\n', null, 'utf-8');
      }
    });
    console.log(`💾 ${filename} exported to: ${outputPath}`);
  }

  private async exportSkipped(skipped: readonly SkippedFile[], filename: string): Promise<void> {
    if (skipped.length === 0) {
      return;
    }
    const header = 'filePath\tbaseMservPath\tserviceVersionHash\treason\tuniqueFileHash';
    const lines = skipped.map((f) => `${f.filePath}\t${f.baseMservPath}\t${f.serviceVersionHash}\t${f.reason}\t${f.uniqueFileHash}`);
    const outputPath = await this.writeAtomically(filename, async (handle) => {
      await handle.write([header, ...lines].join('\n') + '\n', null, 'utf-8');
    });
    console.log(`💾 ${filename} exported to: ${outputPath}`);
  }

  /**
   * Writes a relation to a uniquely named `.partial` file, syncs it, and renames it into
   * place, so a crash mid-write can never leave a relation that is half a file under the
   * name a consumer reads — the guarantee the TypeScript and JavaScript writers make, and
   * the unique temporary name is why two analyzers aimed at one directory cannot interleave.
   */
  private async writeAtomically(filename: string, body: (handle: fs.FileHandle) => Promise<void>): Promise<string> {
    const outputPath = path.join(this.outputDir, filename);
    const temporaryPath = `${outputPath}.${process.pid}-${Date.now()}.partial`;
    const handle = await fs.open(temporaryPath, 'w');
    try {
      await body(handle);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, outputPath);
    return outputPath;
  }
}

/** `target.push(...rows)` without the argument-count ceiling a spread has. */
function append<T>(target: T[], rows: readonly T[]): void {
  for (const row of rows) {
    target.push(row);
  }
}

export function isHtmlFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return HTML_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isCssFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return CSS_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
