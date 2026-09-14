import Parser from 'tree-sitter';

import { GradleBlock } from '@/analysis-types/gradle/GradleBlock';
import { GradleComment } from '@/analysis-types/gradle/GradleComment';
import { GradleDeclaration } from '@/analysis-types/gradle/GradleDeclaration';
import { GradleDependencyCoordinate } from '@/analysis-types/gradle/GradleDependencyCoordinate';
import { GradleParseGap } from '@/analysis-types/gradle/GradleParseGap';
import { GradleValueReference } from '@/analysis-types/gradle/GradleValueReference';
import { GradleBlockType } from '@/enums/gradle/blocks/GradleBlockType';
import { GradleDeclarationType } from '@/enums/gradle/declarations/GradleDeclarationType';
import { GradleDependencyNotation } from '@/enums/gradle/declarations/GradleDependencyNotation';
import { GradlePluginSyntax } from '@/enums/gradle/declarations/GradlePluginSyntax';
import { GradlePropertyScope } from '@/enums/gradle/declarations/GradlePropertyScope';
import { GradleRepositoryType } from '@/enums/gradle/declarations/GradleRepositoryType';
import { GradleTaskStyle } from '@/enums/gradle/declarations/GradleTaskStyle';
import { GradleVersionSource } from '@/enums/gradle/dependencies/GradleVersionSource';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';
import { GradleParseStatus } from '@/enums/gradle/files/GradleParseStatus';
import { GradleScriptKind } from '@/enums/gradle/files/GradleScriptKind';
import { GradleParseGapReason } from '@/enums/gradle/parse-gaps/GradleParseGapReason';
import { GradleReferenceResolution } from '@/enums/gradle/value-references/GradleReferenceResolution';
import { GradleValueReferenceType } from '@/enums/gradle/value-references/GradleValueReferenceType';
import { BaseExtractor } from '@/parsers/base-extractor';
import { DependencyCoordinateParser } from '@/parsers/gradle/dependency-coordinate-parser';
import { GradleCommentScanner } from '@/parsers/gradle/gradle-comment-scanner';
import { GroovyParser } from '@/parsers/gradle/groovy-parser';

/** Everything one Gradle script yields. */
export interface GradleFileExtractionResult {
  blocks: GradleBlock[];
  declarations: GradleDeclaration[];
  valueReferences: GradleValueReference[];
  coordinates: GradleDependencyCoordinate[];
  comments: GradleComment[];
  parseGaps: GradleParseGap[];
  parseStatus: GradleParseStatus;
}

/** What the caller must have decided before a script can be extracted. */
export interface GradleExtractionContext {
  filePath: string;
  baseMservPath: string;
  dialect: GradleDSLDialect;
  /** GRADLE_SCRIPT hash. Every emitted row chains off it. */
  scriptHash: string;
  /**
   * What role the file plays. Needed because the same method name means
   * different things in different scripts — `include` declares a project in a
   * settings file and filters filenames in a copy spec.
   */
  scriptKind: GradleScriptKind;
  serviceVersionHash: string;
}

/**
 * Extracts Gradle entities from a build script using tree-sitter-groovy.
 *
 * Emits blocks, declarations, value references, dependency coordinates,
 * comments and parse gaps from one file.
 *
 * ## The grammar does not match the language, and that shapes everything here
 *
 * tree-sitter-groovy parses Groovy. This extractor is handed Kotlin DSL as
 * well, plus Groovy constructs the grammar has no rule for: GString
 * interpolation, the Elvis operator, empty single-quoted strings, closure
 * parameter lists. Each of those does not merely fail locally — an ERROR node
 * in this grammar swallows the rest of the enclosing block, so one unparseable
 * `?:` on line 12 can silently delete every dependency below it.
 *
 * The answer is to rewrite the source into something the grammar accepts, and
 * then to be honest about it. Two rules keep that from becoming a lie:
 *
 * 1. **Every rewrite preserves line count.** A replacement carries forward the
 *    newlines it consumed, so a position reported against the rewritten text is
 *    a real line in the original file. Without this, one multi-line
 *    interpolation shifts every position below it in the file.
 * 2. **Every lossy rewrite emits a parse gap.** Dropping a closure's parameter
 *    names, a type cast, or a `::class` is information the emitted rows no
 *    longer contain, and a consumer is entitled to know which regions those
 *    were. Rewrites that round-trip — the `__INTERP__` placeholder, the
 *    `'_EMPTY_'` stand-in — are restored afterwards and are not gaps.
 *
 * Comments are scanned off the ORIGINAL bytes rather than read from the tree,
 * for the same reason: whatever an ERROR node swallows is unreachable from the
 * tree, and on a heavily rewritten Kotlin file that is most of it.
 *
 * ## Per-file state
 *
 * `beginFile()` records the file's context — path, dialect, script hash — on
 * the instance, and the walk threads the positional copies it already had.
 * The instance copy is what the rewrite and gap helpers read, since those run
 * outside the walk entirely. Nothing outside `extractScript()` may set it, and
 * the class is therefore single-use per file: one call, one file, state reset
 * at entry.
 */
export class GradleFileExtractor implements BaseExtractor<GradleBlock> {
  private groovyParser: GroovyParser;
  private extractedDeclarations: GradleDeclaration[] = [];
  private extractedValueReferences: GradleValueReference[] = [];
  private extractedCoordinates: GradleDependencyCoordinate[] = [];
  private extractedComments: GradleComment[] = [];
  private extractedParseGaps: GradleParseGap[] = [];
  private originalLines: string[] = [];

  // ── per-file context, set by beginFile() ──
  private filePath: string = '';
  private baseMservPath: string = '';
  private dialect: GradleDSLDialect = GradleDSLDialect.GROOVY;
  private scriptHash: string = '';
  private scriptKind: GradleScriptKind = GradleScriptKind.PROJECT_BUILD;
  private serviceVersionHash: string = '';

  /** Args stripped by the trailing-closure rewrite, keyed by 1-indexed line number. */
  private strippedClosureArgs: Map<number, { methodName: string; args: string }> = new Map();

  /** blockHash → what that block is, for declarations that need their context. */
  private blockContext: Map<string, { type: GradleBlockType; name: string; parent: string }> = new Map();

  constructor() {
    this.groovyParser = new GroovyParser();
  }

  /**
   * Returns all declarations extracted during the last extract() call.
   */
  getExtractedDeclarations(): GradleDeclaration[] {
    return this.extractedDeclarations;
  }

  /**
   * Returns all value references extracted during the last extract() call.
   */
  getExtractedValueReferences(): GradleValueReference[] {
    return this.extractedValueReferences;
  }

  getExtractedCoordinates(): GradleDependencyCoordinate[] {
    return this.extractedCoordinates;
  }

  getExtractedComments(): GradleComment[] {
    return this.extractedComments;
  }

  getExtractedParseGaps(): GradleParseGap[] {
    return this.extractedParseGaps;
  }

  /**
   * BaseExtractor conformance. Derives the context it needs from the path,
   * which is enough for the block/declaration relations but produces a script
   * hash unconnected to the one the workflow assigns.
   *
   * Prefer `extractScript`. This exists so the Gradle extractor still
   * satisfies the same interface as every other one in the repository, and for
   * callers that want blocks out of a single file with no project around it.
   */
  extract(filePath: string, fileContent: string, serviceVersionHash: string): GradleBlock[] {
    return this.extractScript(fileContent, {
      filePath,
      baseMservPath: this.extractBaseMservPath(filePath),
      dialect: this.detectDialect(filePath),
      scriptHash: '',
      scriptKind: GradleScriptKind.PROJECT_BUILD,
      serviceVersionHash,
    }).blocks;
  }

  /**
   * Extracts every relation from one Gradle script.
   *
   * Never throws. A file the grammar cannot handle at all comes back with
   * `parseStatus = FAILED` and a parse-gap row covering it, rather than an
   * empty result that reads identically to a build file declaring nothing.
   */
  extractScript(
    fileContent: string,
    context: GradleExtractionContext
  ): GradleFileExtractionResult {
    this.beginFile(fileContent, context);

    // Comments come off the original bytes, before any rewrite, because a
    // rewritten region can become an ERROR node and everything inside an
    // ERROR node is unreachable from the tree.
    this.collectComments(fileContent);

    const preprocessed = this.preprocess(fileContent);

    let tree: Parser.Tree;
    try {
      tree = this.groovyParser.parse(preprocessed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[GradleFileExtractor] Failed to parse ${context.filePath}: ${message}`);
      this.addGap(
        GradleParseGapReason.PARSE_FAILED,
        1, this.originalLines.length || 1, 0, 0,
        'file', message
      );
      return this.result([], GradleParseStatus.FAILED);
    }

    const rootNode = this.groovyParser.getRootNode(tree);
    const blocks: GradleBlock[] = [];

    this.walkNode(
      rootNode, blocks,
      this.filePath, this.baseMservPath, this.dialect, this.serviceVersionHash,
      '', // parentBlockHash — the root has none
      0   // depth
    );

    // Whatever the grammar could not read. Recorded before the restoration
    // pass so the offsets are the ones the tree actually reported.
    this.collectTreeGaps(rootNode);

    // Placeholders introduced by the round-tripping rewrites go back to the
    // original text they stood in for.
    this.restorePreprocessedValues();

    // The interpolation placeholder hid every ${...} from the reference scan
    // during the walk; now that the real text is back, catch them.
    this.extractRestoredGStringRefs(this.filePath, this.baseMservPath, this.serviceVersionHash);

    // Split every DEPENDENCY declaration into coordinates.
    this.extractCoordinates();

    // Link references to the properties they name, within this file.
    this.resolveValueReferences();

    // Attribute each comment to the innermost block that contains it.
    this.attachComments(blocks);

    // Counts are a property of the finished tree, so they are written last.
    this.populateBlockCounts(blocks);

    return this.result(blocks, this.extractedParseGaps.length ? GradleParseStatus.PARTIAL : GradleParseStatus.OK);
  }

  /**
   * Records a block's identity so a declaration created later in the walk can
   * ask what kind of block encloses it.
   *
   * A declaration's meaning depends on it. `smokeTest.extendsFrom test` is a
   * CONFIGURATION inside `configurations { }` and an ordinary statement
   * anywhere else; `guavaVersion = '1.0'` is an ext property inside `ext { }`
   * and a project property at the top level. The walk knows the enclosing
   * block only as a hash, so the type has to be looked up.
   */
  private registerBlock(block: GradleBlock): void {
    this.blockContext.set(block.getHash(), {
      type: block.getBlockType(),
      name: block.getBlockName(),
      parent: block.getParentBlockHash(),
    });
  }

  /** Whether the given block, or any block above it, is of this type. */
  private isWithin(blockHash: string, type: GradleBlockType): boolean {
    let current = blockHash;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const ctx = this.blockContext.get(current);
      if (!ctx) return false;
      if (ctx.type === type) return true;
      current = ctx.parent;
    }
    return false;
  }

  /** Resets per-file state. Nothing outside extractScript may call this. */
  private beginFile(fileContent: string, context: GradleExtractionContext): void {
    this.extractedDeclarations = [];
    this.extractedValueReferences = [];
    this.extractedCoordinates = [];
    this.extractedComments = [];
    this.extractedParseGaps = [];
    this.strippedClosureArgs = new Map();
    this.blockContext = new Map();
    this.originalLines = fileContent.split('\n');

    this.filePath = context.filePath;
    this.baseMservPath = context.baseMservPath;
    this.dialect = context.dialect;
    this.scriptHash = context.scriptHash;
    this.scriptKind = context.scriptKind;
    this.serviceVersionHash = context.serviceVersionHash;
  }

  private result(blocks: GradleBlock[], parseStatus: GradleParseStatus): GradleFileExtractionResult {
    return {
      blocks,
      declarations: this.extractedDeclarations,
      valueReferences: this.extractedValueReferences,
      coordinates: this.extractedCoordinates,
      comments: this.extractedComments,
      parseGaps: this.extractedParseGaps,
      parseStatus,
    };
  }

  // ─── Preprocessing ─────────────────────────────────────────────

  /**
   * Rewrites the source into something tree-sitter-groovy will accept.
   *
   * Order matters and is not arbitrary:
   *
   *  - Interpolation goes first. A `{` inside `${...}` is a block-opening
   *    brace to this grammar, so leaving one in place corrupts brace matching
   *    for the whole rest of the file — every block boundary after it is wrong.
   *  - Type annotations run before `by` delegation, because the annotation
   *    rewrite is what turns `val x: String by y` into `val x by y`.
   *  - The dependency-wrapper rewrite runs before closure parameters, because
   *    it matches on `config wrapper(` and a stripped closure parameter can
   *    leave text that looks like one.
   *
   * Every step preserves line count. Every lossy step records a gap.
   */
  private preprocess(source: string): string {
    let out = source;
    out = this.normalizeGStringInterpolation(out);   // round-trips
    out = this.stripKotlinTypeAnnotations(out);      // round-trips (type is in the value)
    out = this.stripKotlinByDelegation(out);         // round-trips
    out = this.stripKotlinClassReferences(out);      // LOSSY
    out = this.stripKotlinInlineGenerics(out);       // LOSSY
    out = this.stripKotlinTypeCasts(out);            // LOSSY
    out = this.stripTrailingClosureArgs(out);        // round-trips (args are recovered)
    out = this.normalizeElvisOperator(out);          // LOSSY (changes the operator)
    out = this.normalizeEmptyStringLiterals(out);    // round-trips
    out = this.stripNonAsciiCharacters(out);         // LOSSY
    out = this.convertNamedParamQuotes(out);         // round-trips
    out = this.normalizeDependencyWrapperCalls(out); // round-trips
    out = this.normalizeCatalogAccessorCalls(out);   // round-trips
    out = this.stripClosureParameters(out);          // LOSSY
    return out;
  }

  /**
   * Applies a rewrite, keeping the line count identical and optionally
   * recording each replaced region as a parse gap.
   *
   * The line-count guarantee is the load-bearing part. Positions are reported
   * against the rewritten text, so a rewrite that swallowed a newline would
   * shift every row below it in the file by one line — silently, and only on
   * the files that happen to contain a multi-line construct.
   */
  private rewrite(
    source: string,
    pattern: RegExp,
    replacer: (match: RegExpExecArray) => string,
    reason: GradleParseGapReason | null
  ): string {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;

    while ((m = global.exec(source)) !== null) {
      // A zero-width match would loop forever; step past it.
      if (m[0].length === 0) { global.lastIndex++; continue; }

      const matched = m[0];
      const replacement = replacer(m);
      const newlines = (matched.match(/\n/g) || []).length;

      if (reason) {
        const startLine = this.lineOf(source, m.index);
        const startColumn = m.index - this.lineStartOf(source, m.index);
        this.addGap(
          reason,
          startLine, startLine + newlines,
          startColumn, startColumn + matched.length,
          'preprocessor', matched
        );
      }

      out += source.slice(last, m.index) + replacement + '\n'.repeat(newlines);
      last = m.index + matched.length;
      global.lastIndex = last;
    }

    return out + source.slice(last);
  }

  private lineOf(source: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < source.length; i++) {
      if (source[i] === '\n') line++;
    }
    return line;
  }

  private lineStartOf(source: string, index: number): number {
    const nl = source.lastIndexOf('\n', index - 1);
    return nl < 0 ? 0 : nl + 1;
  }

  private addGap(
    reason: GradleParseGapReason,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    nodeType: string,
    originalText: string
  ): void {
    this.extractedParseGaps.push(
      GradleParseGap.builder(
        reason, this.scriptHash, this.filePath, this.baseMservPath,
        startLine, endLine, startColumn, endColumn, this.serviceVersionHash
      )
        .withNodeType(nodeType)
        .withOriginalText(originalText.length > 400 ? originalText.slice(0, 400) : originalText)
        .build()
    );
  }

  // ─── Parse gaps from the tree ──────────────────────────────────

  /**
   * Walks the finished tree for ERROR and MISSING nodes.
   *
   * Only the OUTERMOST error in any subtree is recorded. tree-sitter nests
   * errors freely, and emitting one row per nested node turns a single
   * unparseable line into dozens of rows that all describe the same region —
   * which makes the parse-gap count useless as a health signal, which is the
   * main thing it is for.
   */
  private collectTreeGaps(root: Parser.SyntaxNode): void {
    const visit = (node: Parser.SyntaxNode): void => {
      if (node.type === 'ERROR' || node.isMissing) {
        this.addGap(
          node.isMissing ? GradleParseGapReason.MISSING_NODE : GradleParseGapReason.ERROR_NODE,
          node.startPosition.row + 1,
          node.endPosition.row + 1,
          node.startPosition.column,
          node.endPosition.column,
          node.type,
          this.originalTextFor(node)
        );
        return; // do not descend: nested errors describe the same region
      }
      for (const child of node.children) visit(child);
    };
    for (const child of root.children) visit(child);
  }

  /**
   * The ORIGINAL text for a node's line range, not the rewritten text the node
   * actually covers. A gap row exists so somebody can go and read what was
   * really there; handing back the parser's own mangled version of it would
   * defeat the purpose.
   */
  private originalTextFor(node: Parser.SyntaxNode): string {
    const from = node.startPosition.row;
    const to = Math.min(node.endPosition.row, this.originalLines.length - 1);
    if (from < 0 || from >= this.originalLines.length) return node.text;
    return this.originalLines.slice(from, to + 1).join('\n').trim();
  }

  // ─── Comments ──────────────────────────────────────────────────

  private collectComments(source: string): void {
    for (const c of GradleCommentScanner.scan(source)) {
      this.extractedComments.push(
        GradleComment.builder(
          c.kind, c.text, this.scriptHash, this.filePath, this.baseMservPath,
          c.startLine, c.endLine, c.startColumn, c.endColumn, this.serviceVersionHash
        )
          .withIsCommentedOutCode(c.isCommentedOutCode)
          .build()
      );
    }
  }

  /**
   * Attributes each comment to the innermost block whose line range contains
   * it, and to the first declaration that starts at or after it.
   *
   * Innermost wins because a comment inside `dependencies { }` is about a
   * dependency, not about the file. Ties are broken by the narrower range,
   * which is what "innermost" means once two blocks start on the same line.
   */
  private attachComments(blocks: GradleBlock[]): void {
    if (!this.extractedComments.length) return;

    const sortedDecls = [...this.extractedDeclarations].sort(
      (a, b) => a.getStartLine() - b.getStartLine()
    );

    for (const comment of this.extractedComments) {
      const line = comment.getStartLine();

      let best: GradleBlock | undefined;
      let bestSpan = Number.MAX_SAFE_INTEGER;
      for (const block of blocks) {
        if (block.getStartLine() > line || block.getEndLine() < line) continue;
        const span = block.getEndLine() - block.getStartLine();
        if (span < bestSpan) { best = block; bestSpan = span; }
      }
      if (best) comment.setOwnerBlockHash(best.getHash());

      const next = sortedDecls.find((d) => d.getStartLine() >= line);
      if (next) comment.setNextDeclarationHash(next.getHash());
    }
  }

  // ─── Block counts ──────────────────────────────────────────────

  /**
   * Fills childBlockCount and declarationCount, which were columns that
   * always read zero.
   *
   * Counts direct children only. A recursive total would make
   * `childBlockCount` on a root block equal the file's block count, and a
   * consumer summing the column would then count every block once per
   * ancestor.
   */
  private populateBlockCounts(blocks: GradleBlock[]): void {
    const childBlocks = new Map<string, number>();
    const childDecls = new Map<string, number>();

    for (const block of blocks) {
      const parent = block.getParentBlockHash();
      if (parent) childBlocks.set(parent, (childBlocks.get(parent) ?? 0) + 1);
    }
    for (const decl of this.extractedDeclarations) {
      const parent = decl.getParentBlockHash();
      if (parent) childDecls.set(parent, (childDecls.get(parent) ?? 0) + 1);
    }

    for (const block of blocks) {
      block.setChildBlockCount(childBlocks.get(block.getHash()) ?? 0);
      block.setDeclarationCount(childDecls.get(block.getHash()) ?? 0);
    }
  }

  /**
   * Restores preprocessing placeholders (__INTERP__, _EMPTY_) in extracted
   * declaration names/values back to the original source text.
   *
   * Uses the stored originalLines to find the real ${...} expressions
   * for each declaration's line range.
   */
  private restorePreprocessedValues(): void {
    const restored: GradleDeclaration[] = [];
    const remap = new Map<string, string>();
    for (const decl of this.extractedDeclarations) {
      const name = decl.getName();
      const value = decl.getValue();

      // Check if declaration needs placeholder restoration
      const needsPlaceholderRestore =
        name.includes('__INTERP__') || name.includes('_EMPTY_') ||
        value.includes('__INTERP__') || value.includes('_EMPTY_');

      // Check if declaration spans lines where step 6 stripped closure args
      let needsClosureArgRestore = false;
      for (let ln = decl.getStartLine(); ln <= decl.getEndLine(); ln++) {
        if (this.strippedClosureArgs.has(ln)) { needsClosureArgRestore = true; break; }
      }

      if (!needsPlaceholderRestore && !needsClosureArgRestore) {
        restored.push(decl);
        continue;
      }

      let restoredName = needsPlaceholderRestore
        ? this.restorePreprocessing(name, decl.getStartLine(), decl.getEndLine())
        : name;
      let restoredValue = needsPlaceholderRestore
        ? this.restorePreprocessing(value, decl.getStartLine(), decl.getEndLine())
        : value;

      // Restore stripped closure args: replace "methodName {" with "methodName(args) {"
      if (needsClosureArgRestore) {
        for (let ln = decl.getStartLine(); ln <= decl.getEndLine(); ln++) {
          const saved = this.strippedClosureArgs.get(ln);
          if (!saved) continue;
          const stripped = saved.methodName + ' {';
          const restored_text = saved.methodName + '(' + saved.args + ') {';
          restoredName = restoredName.replace(stripped, restored_text);
          restoredValue = restoredValue.replace(stripped, restored_text);
        }
      }

      // Rebuild the declaration with restored text
      const rebuilt = GradleDeclaration.builder(
        decl.getDeclarationType(), restoredName, decl.getDslDialect(),
        decl.getParentBlockHash(), decl.getScriptHash(), decl.getFilePath(), decl.getBaseMservPath(),
        decl.getStartLine(), decl.getEndLine(),
        decl.getStartColumn(), decl.getEndColumn(),
        decl.getServiceVersionLinkHash()
      )
        .withValue(restoredValue)
        .withNotation(decl.getNotation())
        .withQualifier(decl.getQualifier())
        .withHasConfigBlock(decl.getHasConfigBlock())
        .withReason(decl.getReason())
        .build();

      // Rebuilding changes the declaration's content and therefore its key.
      // Any value reference created during the walk still points at the old
      // one, and would be left dangling — a foreign key into a row that no
      // longer exists, which is strictly worse than an empty one. Remap them.
      remap.set(decl.getHash(), rebuilt.getHash());
      restored.push(rebuilt);
    }
    this.extractedDeclarations = restored;

    if (remap.size) this.remapDeclarationHashes(remap);
  }

  /**
   * Re-points every child row at a declaration's new key.
   *
   * Value references are rebuilt rather than mutated because the owning
   * declaration's hash is part of THEIR key too — chaining means a parent
   * re-key cascades, and quietly leaving the child's own key derived from the
   * dead parent would make two runs of the same file disagree.
   */
  private remapDeclarationHashes(remap: Map<string, string>): void {
    this.extractedValueReferences = this.extractedValueReferences.map((ref) => {
      const next = remap.get(ref.getOwnerDeclarationHash());
      if (!next) return ref;

      const rebuilt = GradleValueReference.builder(
        ref.getReferenceExpression(), ref.getReferenceType(), ref.getRawFragment(),
        ref.getScriptHash(), ref.getFilePath(), ref.getBaseMservPath(),
        ref.getStartLine(), ref.getEndLine(), ref.getStartColumn(), ref.getEndColumn(),
        ref.getServiceVersionLinkHash()
      )
        .withOwnerDeclarationHash(next)
        .withOwnerBlockHash(ref.getOwnerBlockHash())
        .withDefaultValue(ref.getDefaultValue())
        .withResolutionKind(ref.getResolutionKind())
        .build();
      return rebuilt;
    });
  }

  /**
   * Replaces __INTERP__ and _EMPTY_ placeholders in text with original
   * source content from the given line range.
   */
  private restorePreprocessing(text: string, startLine: number, endLine: number): string {
    let result = text;

    // Restore __INTERP__ → original ${...} expressions
    if (result.includes('__INTERP__')) {
      for (let i = startLine - 1; i < endLine && i < this.originalLines.length; i++) {
        const line = this.originalLines[i];
        if (!line) continue;
        const matches = line.match(/\$\{[^}]+\}/g);
        if (matches) {
          for (const m of matches) {
            result = result.replace('__INTERP__', m);
          }
        }
      }
    }

    // Restore '_EMPTY_' → '' (handles both single and double quote wrappers)
    result = result.replace(/'_EMPTY_'/g, "''").replace(/"_EMPTY_"/g, "''");

    return result;
  }

  /**
   * Post-restoration pass: scans restored declaration names/values for
   * GString interpolation patterns (${expr}, $var) and emits value references.
   *
   * During AST walking, step 0 had replaced ${...} with __INTERP__, so
   * scanStringForGStringRefs could not detect them. After restorePreprocessedValues
   * puts the original text back, this pass catches those references.
   */
  private extractRestoredGStringRefs(
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    for (const decl of this.extractedDeclarations) {
      const value = decl.getValue();
      const name = decl.getName();
      // Only process declarations whose restored text actually contains $
      if (!value.includes('$') && !name.includes('$')) continue;

      const startLine = decl.getStartLine();
      const endLine = decl.getEndLine();
      const startCol = decl.getStartColumn();
      const endCol = decl.getEndColumn();
      const ownerHash = decl.getHash();
      const blockHash = decl.getParentBlockHash();

      // Scan both name and value for GString patterns
      for (const text of [name, value]) {
        if (!text.includes('$')) continue;

        // ${expr} patterns
        const fullPattern = /\$\{([^}]+)\}/g;
        let match: RegExpExecArray | null;
        while ((match = fullPattern.exec(text)) !== null) {
          const expr = (match[1] ?? '').trim();
          // Check if this exact ref was already captured (avoid duplicates)
          const alreadyExists = this.extractedValueReferences.some(
            r => r.getReferenceExpression() === expr && r.getOwnerDeclarationHash() === ownerHash
          );
          if (alreadyExists) continue;

          const refType = expr.includes('.')
            ? GradleValueReferenceType.EXT_PROPERTY_ACCESS
            : GradleValueReferenceType.GSTRING_INTERPOLATION;

          const ref = GradleValueReference.builder(
            expr, refType, match[0],
            this.scriptHash,
            filePath, baseMservPath,
            startLine, endLine, startCol, endCol,
            serviceVersionHash
          )
            .withOwnerDeclarationHash(ownerHash)
            .withOwnerBlockHash(blockHash)
            .build();
          this.extractedValueReferences.push(ref);
        }

        // $varName patterns (skip if inside ${...})
        const simplePattern = /\$([a-zA-Z_][a-zA-Z0-9_.]*)/g;
        while ((match = simplePattern.exec(text)) !== null) {
          if (match.index > 0 && text[match.index + 1] === '{') continue;
          const inFullInterp = text.substring(0, match.index).lastIndexOf('${') > text.substring(0, match.index).lastIndexOf('}');
          if (inFullInterp) continue;

          const simpleExpr = match[1] ?? '';
          const alreadyExists = this.extractedValueReferences.some(
            r => r.getReferenceExpression() === simpleExpr && r.getOwnerDeclarationHash() === ownerHash
          );
          if (alreadyExists) continue;

          const refType = simpleExpr.includes('.')
            ? GradleValueReferenceType.EXT_PROPERTY_ACCESS
            : GradleValueReferenceType.GSTRING_SIMPLE;

          const ref = GradleValueReference.builder(
            simpleExpr, refType, match[0],
            this.scriptHash,
            filePath, baseMservPath,
            startLine, endLine, startCol, endCol,
            serviceVersionHash
          )
            .withOwnerDeclarationHash(ownerHash)
            .withOwnerBlockHash(blockHash)
            .build();
          this.extractedValueReferences.push(ref);
        }
      }
    }
  }

  // ─── AST Walking ───────────────────────────────────────────────

  /**
   * Recursively walks the AST, identifying blocks and declarations.
   */
  private walkNode(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      switch (child.type) {
        case 'expression_statement':
          this.processExpressionStatement(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash, depth
          );
          break;

        // A one-line closure — `dependencies { implementation("a:b:1.0") }` —
        // puts the call directly under the closure, where a multi-line one
        // wraps it in an expression_statement. Without these cases the call
        // fell to the catch-all and became a STATEMENT named
        // `method_invocation: implementation(...)`, so a build that writes its
        // dependencies on one line reported none at all.
        case 'method_invocation':
        case 'function_call':
          this.processMethodInvocation(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'assignment':
        case 'assignment_expression':
          this.processAssignment(
            child, child, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash
          );
          break;

        case 'if_statement':
          this.processControlFlow(
            child, GradleBlockType.IF, blocks, filePath, baseMservPath,
            dialect, serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'for_statement':
          this.processControlFlow(
            child, GradleBlockType.FOR, blocks, filePath, baseMservPath,
            dialect, serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'for_in_statement':
          this.processControlFlow(
            child, GradleBlockType.FOR_EACH, blocks, filePath, baseMservPath,
            dialect, serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'while_statement':
          this.processControlFlow(
            child, GradleBlockType.WHILE, blocks, filePath, baseMservPath,
            dialect, serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'do_while_statement':
          this.processControlFlow(
            child, GradleBlockType.DO_WHILE, blocks, filePath, baseMservPath,
            dialect, serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'try_statement':
          this.processTryStatement(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'switch_statement':
          this.processSwitchStatement(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash, depth
          );
          break;

        case 'local_variable_declaration':
          this.processLocalVariableDeclaration(
            child, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash
          );
          break;

        case 'juxt_function_call': {
          // Try Kotlin DSL plugin pattern: id("...") version "x.y.z" [apply false]
          // tree-sitter-groovy splits this across siblings, so we need lookahead
          const consumed = this.tryProcessPluginIdDeclaration(
            child, children, i, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash
          );
          if (consumed > 0) {
            i += consumed; // Skip consumed sibling nodes
          } else {
            // Check for split dependency wrapper pattern:
            // juxt_function_call(implementation, project) + expression_statement((':core'))
            let mergeNode: Parser.SyntaxNode | undefined;
            const firstId = this.getFirstIdentifier(child);
            const argText = this.getApplicationArgText(child);
            if (GradleFileExtractor.DEPENDENCY_CONFIGS.has(firstId) &&
                GradleFileExtractor.DEPENDENCY_WRAPPER_FUNCTIONS.has(argText)) {
              const nextSibling = children[i + 1];
              if (nextSibling?.type === 'expression_statement') {
                const parenExpr = nextSibling.children.find(
                  (c: Parser.SyntaxNode) => c.type === 'parenthesized_expression'
                );
                if (parenExpr) {
                  mergeNode = nextSibling;
                  i++; // skip the consumed sibling
                }
              }
            }
            this.processApplicationExpression(
              child, blocks, filePath, baseMservPath, dialect,
              serviceVersionHash, parentBlockHash, depth, mergeNode
            );
          }
          break;
        }

        case 'import':
        case 'import_declaration':
        case 'package_declaration':
        case 'class_declaration':
        case 'return_statement':
        case 'throw_statement':
          this.processUncategorizedStatement(
            child, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash
          );
          break;

        default:
          // Skip structural/token nodes; capture anything else as STATEMENT
          if (child.isNamed && !GradleFileExtractor.STRUCTURAL_NODE_TYPES.has(child.type)) {
            this.processUncategorizedStatement(
              child, filePath, baseMservPath, dialect,
              serviceVersionHash, parentBlockHash
            );
          }
          // Continue walking for any children
          this.walkNode(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, parentBlockHash, depth
          );
          break;
      }
    }
  }

  // ─── Expression Statement Processing ───────────────────────────

  /**
   * Processes an expression_statement, which in Gradle DSL is the
   * most common top-level pattern:
   *   - method_invocation with closure → DSL block (dependencies { }, plugins { })
   *   - assignment → property
   *   - plain method call → declaration or statement
   */
  private processExpressionStatement(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    const expr = node.children[0];
    if (!expr) return;

    if (expr.type === 'method_invocation' || expr.type === 'function_call') {
      this.processMethodInvocation(
        expr, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash, depth
      );
    } else if (expr.type === 'assignment' || expr.type === 'assignment_expression') {
      this.processAssignment(
        expr, node, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash
      );
    } else if (expr.type === 'application_expression' || expr.type === 'juxt_function_call') {
      // Groovy DSL pattern: methodName arg1, arg2 (no parens)
      this.processApplicationExpression(
        expr, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash, depth
      );
    } else {
      // Catch-all: capture any other expression type as STATEMENT
      this.processUncategorizedStatement(
        node, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash
      );
    }
  }

  // ─── DSL Block Detection ───────────────────────────────────────

  /**
   * Maps well-known Gradle DSL block names to their GradleBlockType.
   */
  private static readonly DSL_BLOCK_MAP: Record<string, GradleBlockType> = {
    'plugins': GradleBlockType.PLUGINS,
    'dependencies': GradleBlockType.DEPENDENCIES,
    'repositories': GradleBlockType.REPOSITORIES,
    'allprojects': GradleBlockType.ALLPROJECTS,
    'subprojects': GradleBlockType.SUBPROJECTS,
    'buildscript': GradleBlockType.BUILDSCRIPT,
    'ext': GradleBlockType.EXT,
    'configurations': GradleBlockType.CONFIGURATIONS,
    'task': GradleBlockType.TASK,
  };

  /**
   * Processes a method invocation that may have a closure (DSL block).
   * Example: dependencies { ... } → method_invocation with closure child
   */
  private processMethodInvocation(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    const methodName = this.getMethodName(node);
    const closureNode = this.findChildByType(node, 'closure');

    if (closureNode) {
      // This is a DSL block: methodName { ... }
      const blockType = GradleFileExtractor.DSL_BLOCK_MAP[methodName] || GradleBlockType.DSL_BLOCK;

      const block = GradleBlock.builder(
        blockType,
        depth,
        dialect,
        this.scriptHash,
        filePath,
        baseMservPath,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        node.startPosition.column,
        node.endPosition.column,
        serviceVersionHash
      )
        .withBlockName(methodName)
        .withParentBlockHash(parentBlockHash)
        .build();

      this.registerBlock(block);

      blocks.push(block);

      // Recover stripped args for method("arg") { closure } patterns
      this.recoverStrippedClosureArgs(
        node, block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
      );

      // maven { }, ivy { }, flatDir { } inside repositories { }
      this.emitRepositoryBlockDeclaration(
        block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
      );

      // Recurse into the closure body
      this.walkNode(
        closureNode, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, block.getHash(), depth + 1
      );
    } else {
      // No closure → this is a declaration/statement inside a block
      this.processDeclarationFromMethodCall(
        node, methodName, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash
      );
    }
  }

  /**
   * Processes Groovy application expression (no-paren method calls).
   * Example: implementation 'com.google.guava:guava:32.1.3-jre'
   */
  private processApplicationExpression(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number,
    mergeNode?: Parser.SyntaxNode
  ): void {
    const methodName = this.getFirstIdentifier(node);
    const closureNode = this.findChildByType(node, 'closure');

    if (closureNode) {
      // DSL block via application expression: task hello { ... }
      const blockType = GradleFileExtractor.DSL_BLOCK_MAP[methodName] || GradleBlockType.DSL_BLOCK;

      const block = GradleBlock.builder(
        blockType,
        depth,
        dialect,
        this.scriptHash,
        filePath,
        baseMservPath,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        node.startPosition.column,
        node.endPosition.column,
        serviceVersionHash
      )
        .withBlockName(methodName)
        .withParentBlockHash(parentBlockHash)
        .build();

      this.registerBlock(block);

      blocks.push(block);

      // Recover stripped args for method("arg") { closure } patterns
      this.recoverStrippedClosureArgs(
        node, block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
      );

      // maven { }, ivy { }, flatDir { } inside repositories { }
      this.emitRepositoryBlockDeclaration(
        block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
      );

      this.walkNode(
        closureNode, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, block.getHash(), depth + 1
      );
    } else {
      // No closure → declaration (e.g., implementation 'guava:...')
      this.processDeclarationFromApplicationExpr(
        node, methodName, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash, mergeNode
      );
    }
  }

  /**
   * When step 6 strips method("arg") { closure } → method { closure },
   * this method recovers the stripped args and emits a declaration
   * linked to the block.  DEPENDENCY for dep configs, STATEMENT for others.
   */
  private recoverStrippedClosureArgs(
    node: Parser.SyntaxNode,
    block: GradleBlock,
    blockMethodName: string,
    dialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const startLine = node.startPosition.row + 1;
    const saved = this.strippedClosureArgs.get(startLine);
    if (!saved) return;

    const { args } = saved;
    // The stashed name carries the receiver (`tasks.register`); the block's own
    // name is just the last segment, so the stashed one is what classifies.
    const endLine = node.endPosition.row + 1;
    const startCol = node.startPosition.column;
    const endCol = node.endPosition.column;

    if (GradleFileExtractor.DEPENDENCY_CONFIGS.has(blockMethodName)) {
      const notation = this.classifyDependencyNotation(args);
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.DEPENDENCY, args, dialect, block.getHash(),
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startCol, endCol,
        serviceVersionHash
      )
        .withValue(args)
        .withQualifier(blockMethodName)
        .withNotation(notation)
        .build();
      this.extractedDeclarations.push(decl);
      return;
    }

    // `tasks.register('copyDocs', Copy) { }` reaches here rather than the
    // declaration path, because the trailing-closure rewrite turned it into
    // `tasks.register { }` — a block. Without this the task is a STATEMENT and
    // TASKS_REGISTER is a style nothing ever produces.
    const task = this.classifyTask(saved.methodName, args, false);
    if (task && task.taskName) {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.TASK, task.taskName, dialect, block.getHash(),
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startCol, endCol,
        serviceVersionHash
      )
        .withValue(args)
        .withNotation(task.style)
        .withQualifier(task.taskType)
        .withHasConfigBlock(true)
        .build();
      this.extractedDeclarations.push(decl);
      return;
    }

    {
      // Non-dep-config: emit as STATEMENT linked to the block
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.STATEMENT, saved.methodName, dialect, block.getHash(),
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startCol, endCol,
        serviceVersionHash
      )
        .withValue(args)
        .build();
      this.extractedDeclarations.push(decl);
    }
  }

  // ─── Declaration Extraction ────────────────────────────────────

  /** Node types that are structural/tokens and should NOT be captured as statements in the default catch-all. */
  private static readonly STRUCTURAL_NODE_TYPES = new Set([
    'block', 'closure', 'argument_list', 'arguments', 'parenthesized_expression',
    'identifier', 'string_literal', 'character_literal', 'number_literal',
    'boolean_literal', 'null_literal', 'comment', 'line_comment', 'block_comment',
    'ERROR', 'program', 'source_file',
  ]);

  /** Known dependency wrapper functions that take arguments in parens.
   *  tree-sitter-groovy sometimes splits `implementation project(':core')` into
   *  juxt_function_call(implementation, project) + expression_statement((':core')).
   *  When this split is detected, the extractor merges them back together. */
  private static readonly DEPENDENCY_WRAPPER_FUNCTIONS = new Set([
    'project', 'files', 'fileTree', 'platform', 'enforcedPlatform',
    'testFixtures', 'gradleApi', 'gradleTestKit', 'localGroovy',
  ]);

  /** Known dependency configuration names */
  private static readonly DEPENDENCY_CONFIGS = new Set([
    'implementation', 'api', 'compileOnly', 'runtimeOnly',
    'testImplementation', 'testCompileOnly', 'testRuntimeOnly',
    'annotationProcessor', 'testAnnotationProcessor', 'kapt', 'ksp',
    'classpath', 'compile', 'runtime', 'testCompile', 'testRuntime',
    'compileOnlyApi', 'debugImplementation', 'releaseImplementation',
    'developmentOnly', 'providedCompile', 'providedRuntime',
    'debugApi', 'debugCompileOnly', 'debugRuntimeOnly',
    'releaseApi', 'releaseCompileOnly', 'releaseRuntimeOnly',
    'androidTestImplementation', 'androidTestApi', 'androidTestCompileOnly', 'androidTestRuntimeOnly',
    'testFixturesImplementation', 'testFixturesApi', 'testFixturesCompileOnly', 'testFixturesRuntimeOnly',
  ]);

  /** Known repository shortcut names */
  private static readonly REPOSITORY_SHORTCUTS: Record<string, GradleRepositoryType> = {
    'mavenCentral': GradleRepositoryType.MAVEN_CENTRAL,
    'mavenLocal': GradleRepositoryType.MAVEN_LOCAL,
    'google': GradleRepositoryType.GOOGLE,
    'gradlePluginPortal': GradleRepositoryType.GRADLE_PLUGIN_PORTAL,
    'jcenter': GradleRepositoryType.JCENTER,
  };

  /** `tasks.register('x')` and friends: the method name to the task style. */
  private static readonly TASK_METHOD_STYLES: Record<string, GradleTaskStyle> = {
    'register': GradleTaskStyle.TASKS_REGISTER,
    'named': GradleTaskStyle.TASKS_NAMED,
    'create': GradleTaskStyle.TASKS_REGISTER,
    'maybeCreate': GradleTaskStyle.TASKS_REGISTER,
    'addRule': GradleTaskStyle.TASK_RULE,
  };

  /**
   * Recognises a task definition or configuration.
   *
   * `TASK` was one of the eight declaration types and nothing ever emitted it:
   * `task hello { }` produced a TASK block with no declaration under it, and
   * `tasks.register('hello')` produced a STATEMENT indistinguishable from any
   * other method call. Both are now TASK rows carrying the style that created
   * them, because "which tasks exist and how were they declared" is a question
   * the block tree alone cannot answer.
   *
   * @param methodName Receiver-qualified where the grammar gave one, e.g.
   *                   `tasks.register`.
   * @returns The style and the task's own name, or null if not a task.
   */
  private classifyTask(
    methodName: string,
    args: string,
    hasTypeArgument: boolean
  ): { style: GradleTaskStyle; taskName: string; taskType: string } | null {
    const segments = methodName.split('.');
    const last = segments[segments.length - 1] ?? '';
    const receiver = segments.length > 1 ? segments[segments.length - 2] : '';

    // task hello  /  task hello(type: Copy)
    if (methodName === 'task') {
      const first = (DependencyCoordinateParser.splitTopLevel(args, ',')[0] ?? '').trim();
      const typed = /type\s*:\s*([A-Za-z_][\w.]*)/.exec(args);
      return {
        style: typed ? GradleTaskStyle.TASK_KEYWORD_TYPED : GradleTaskStyle.TASK_KEYWORD,
        taskName: this.stripQuotes(first),
        taskType: typed ? (typed[1] ?? '') : '',
      };
    }

    // tasks.register(...) / tasks.named(...) / tasks.create(...)
    if (receiver !== 'tasks') return null;
    const base = GradleFileExtractor.TASK_METHOD_STYLES[last];
    if (!base) return null;

    const parts = DependencyCoordinateParser.splitTopLevel(args, ',').map((a) => a.trim());
    const taskName = this.stripQuotes(parts[0] ?? '');
    // Either `tasks.register('x', Copy)` or `tasks.register<Copy>("x")` — and
    // the second form has already had its type argument stripped by
    // preprocessing, which is why hasTypeArgument is passed in rather than
    // read off the text.
    const secondArg = parts.length > 1 ? (parts[1] ?? '') : '';
    const taskType = secondArg && !secondArg.includes(':') ? secondArg : '';
    const typed = Boolean(taskType) || hasTypeArgument;

    let style = base;
    if (typed && base === GradleTaskStyle.TASKS_REGISTER) style = GradleTaskStyle.TASKS_REGISTER_TYPED;
    if (typed && base === GradleTaskStyle.TASKS_NAMED) style = GradleTaskStyle.TASKS_NAMED_TYPED;

    return { style, taskName, taskType };
  }

  /**
   * The property scope for an assignment, from the block that encloses it.
   *
   * `GradlePropertyScope` was a fully documented enum that nothing ever used,
   * so every PROPERTY row carried an empty qualifier and `ext { }` properties
   * were indistinguishable from project properties. They behave differently —
   * an ext property is visible to subprojects and a local `def` is not — so a
   * consumer resolving a version reference needs to know which it found.
   */
  private propertyScopeFor(name: string, parentBlockHash: string, isLocalVar: boolean): GradlePropertyScope {
    if (name.startsWith('ext.') || name.startsWith('project.ext.')) return GradlePropertyScope.EXT_SINGLE;

    if (this.isWithin(parentBlockHash, GradleBlockType.EXT)) {
      return this.isWithin(parentBlockHash, GradleBlockType.BUILDSCRIPT)
        ? GradlePropertyScope.BUILDSCRIPT_EXT
        : GradlePropertyScope.EXT_BLOCK;
    }

    // A `def`/`val` is script-local: not a project property, and not visible
    // to any other script. Collapsing it into PROJECT would make a downstream
    // "which projects set this version" query claim reach it does not have.
    if (isLocalVar) return GradlePropertyScope.LOCAL_VARIABLE;

    return GradlePropertyScope.PROJECT;
  }

  /**
   * Creates a declaration from a method call without closure.
   * Determines if it's a dependency, plugin, repository, task, configuration,
   * exclusion, or generic statement.
   */
  private processDeclarationFromMethodCall(
    node: Parser.SyntaxNode,
    methodName: string,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string
  ): void {
    const args = this.getArgumentsText(node);
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    // Dependency: implementation("group:artifact:version")
    if (GradleFileExtractor.DEPENDENCY_CONFIGS.has(methodName)) {
      const notation = this.classifyDependencyNotation(args);
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.DEPENDENCY, args, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withValue(args)
        .withQualifier(methodName)
        .withNotation(notation)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Repository shortcut: mavenCentral()
    const repoType = GradleFileExtractor.REPOSITORY_SHORTCUTS[methodName];
    if (repoType) {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.REPOSITORY, methodName, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withNotation(repoType)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, methodName, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Plugin: id 'org.springframework.boot' (inside plugins block)
    if (methodName === 'id') {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PLUGIN, args, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withNotation(GradlePluginSyntax.PLUGINS_BLOCK_ID)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Include: include ':core', ':auth'
    //
    // Only in a settings script. `include` is a method on Settings there, but
    // in a build script it is a CopySpec filter — `from('src') { include
    // '*.txt' }` — and treating those as project includes invents projects
    // that do not exist. Spring Framework alone produced three.
    if (this.isSettingsScript() && (methodName === 'include' || methodName === 'includeBuild')) {
      // One row per included path. `include ':a', ':b'` declares two projects,
      // and packing both into one row makes the project graph unqueryable.
      for (const piece of DependencyCoordinateParser.splitTopLevel(args, ',')) {
        const projectPath = this.normalizeProjectPath(this.stripQuotes(piece.trim()));
        if (!projectPath) continue;
        const decl = GradleDeclaration.builder(
          GradleDeclarationType.INCLUDE, projectPath, dialect, parentBlockHash,
          this.scriptHash,
          filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
          serviceVersionHash
        )
          .withValue(projectPath)
          .withQualifier(methodName)
          .build();
        this.extractedDeclarations.push(decl);
        this.extractValueReferences(node, projectPath, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      }
      return;
    }

    if (this.emitTaskOrConfigOrExclude(
      node, methodName, args, dialect, filePath, baseMservPath,
      startLine, endLine, startColumn, endColumn, serviceVersionHash, parentBlockHash
    )) {
      return;
    }

    // Fallback: generic STATEMENT
    const stmtDecl = GradleDeclaration.builder(
      GradleDeclarationType.STATEMENT, methodName, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(args)
      .build();

    this.extractedDeclarations.push(stmtDecl);
    this.extractValueReferences(node, args, stmtDecl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
  }

  /**
   * Creates a declaration from an application expression (no-paren call).
   * Example: implementation 'com.google.guava:guava:32.1.3-jre'
   */
  private processDeclarationFromApplicationExpr(
    node: Parser.SyntaxNode,
    methodName: string,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    mergeNode?: Parser.SyntaxNode
  ): void {
    // Get everything after the method name as the argument
    let args = this.getApplicationArgText(node);

    // Merge split wrapper function args: project + (':core') → project(':core')
    if (mergeNode) {
      const parenExpr = mergeNode.children.find(
        (c: Parser.SyntaxNode) => c.type === 'parenthesized_expression'
      );
      if (parenExpr) {
        args = args + parenExpr.text;
      }
    }
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    // Dependency: implementation 'group:artifact:version'
    if (GradleFileExtractor.DEPENDENCY_CONFIGS.has(methodName)) {
      const notation = this.classifyDependencyNotation(args);
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.DEPENDENCY, args, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withValue(args)
        .withQualifier(methodName)
        .withNotation(notation)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Plugin: id 'org.springframework.boot' (inside a plugins block).
    // The method-call path recognised this; the no-paren path did not, so
    // `plugins { id 'java' }` produced a STATEMENT named `id` and the build's
    // plugins were absent from the plugin relation.
    if (methodName === 'id') {
      const pluginId = this.stripQuotes(args.trim());
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PLUGIN, pluginId, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withNotation(GradlePluginSyntax.PLUGINS_BLOCK_ID)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // apply plugin: 'java'
    if (methodName === 'apply') {
      this.processApplyStatement(
        node, args, dialect, filePath, baseMservPath,
        startLine, endLine, startColumn, endColumn,
        serviceVersionHash, parentBlockHash
      );
      return;
    }

    // Include: include ':core', ':auth' — settings scripts only, see above.
    if (this.isSettingsScript() && (methodName === 'include' || methodName === 'includeBuild')) {
      for (const piece of DependencyCoordinateParser.splitTopLevel(args, ',')) {
        const projectPath = this.normalizeProjectPath(this.stripQuotes(piece.trim()));
        if (!projectPath) continue;
        const decl = GradleDeclaration.builder(
          GradleDeclarationType.INCLUDE, projectPath, dialect, parentBlockHash,
          this.scriptHash,
          filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
          serviceVersionHash
        )
          .withValue(projectPath)
          .withQualifier(methodName)
          .build();
        this.extractedDeclarations.push(decl);
        this.extractValueReferences(node, projectPath, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      }
      return;
    }

    if (this.emitTaskOrConfigOrExclude(
      node, methodName, args, dialect, filePath, baseMservPath,
      startLine, endLine, startColumn, endColumn, serviceVersionHash, parentBlockHash
    )) {
      return;
    }

    // Fallback: generic STATEMENT
    const decl2 = GradleDeclaration.builder(
      GradleDeclarationType.STATEMENT, methodName, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(args)
      .build();

    this.extractedDeclarations.push(decl2);
    this.extractValueReferences(node, args, decl2.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
  }

  /**
   * Emits the three declaration kinds that need their enclosing block to be
   * recognised at all, and reports whether it handled the statement.
   *
   * All three were previously swallowed by the STATEMENT catch-all, which is
   * why `GradleTaskStyle` and the CONFIGURATION and EXCLUDE arms of the
   * declaration type existed with nothing producing them.
   */
  private emitTaskOrConfigOrExclude(
    node: Parser.SyntaxNode,
    methodName: string,
    args: string,
    dialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionHash: string,
    parentBlockHash: string
  ): boolean {
    // exclude group: 'x', module: 'y' — a fact about the dependency graph, not
    // a generic method call, and the reason EXCLUDE is its own type.
    if (methodName === 'exclude' || methodName.endsWith('.exclude')) {
      const group = /group\s*:\s*['"]([^'"]*)['"]/.exec(args)?.[1] ?? '';
      const module = /(?:module|name)\s*:\s*['"]([^'"]*)['"]/.exec(args)?.[1] ?? '';
      const coordinate = group && module ? `${group}:${module}` : (group || module || args);
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.EXCLUDE, coordinate, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withValue(args)
        .withQualifier(this.blockContext.get(parentBlockHash)?.name ?? '')
        .build();
      this.extractedDeclarations.push(decl);
      return true;
    }

    const task = this.classifyTask(methodName, args, this.strippedClosureArgs.has(startLine));
    if (task && task.taskName) {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.TASK, task.taskName, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withValue(args)
        .withNotation(task.style)
        .withQualifier(task.taskType)
        .build();
      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return true;
    }

    // Inside configurations { }, a bare name declares a configuration and
    // `name.extendsFrom other` wires it to another. Outside that block the
    // same text is an ordinary call, which is why this checks the ancestry
    // rather than the method name.
    if (this.isWithin(parentBlockHash, GradleBlockType.CONFIGURATIONS)) {
      const extendsFrom = methodName.endsWith('.extendsFrom') || args.includes('extendsFrom');
      const name = methodName.split('.')[0] ?? methodName;
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.CONFIGURATION, name, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withValue(extendsFrom ? args : '')
        .withQualifier(extendsFrom ? 'extendsFrom' : '')
        .build();
      this.extractedDeclarations.push(decl);
      return true;
    }

    return false;
  }

  // ─── Uncategorized Statement Catch-All ─────────────────────

  /**
   * Creates a STATEMENT declaration for any node type not explicitly handled.
   * Captures imports, package declarations, class definitions, return/throw,
   * and any other unrecognized statement-level constructs.
   */
  private processUncategorizedStatement(
    node: Parser.SyntaxNode,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string
  ): void {
    const nodeType = node.type;
    const text = node.text.split('\n')[0]?.trim() || '';
    const name = `${nodeType}: ${text}`;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    const decl = GradleDeclaration.builder(
      GradleDeclarationType.STATEMENT, name, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(node.text.trim())
      .build();

    this.extractedDeclarations.push(decl);
  }

  // ─── Assignment Processing ─────────────────────────────────────

  /**
   * Processes an assignment: variable = value → PROPERTY declaration.
   */
  private processAssignment(
    node: Parser.SyntaxNode,
    exprStmt: Parser.SyntaxNode,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string
  ): void {
    const lhs = node.children[0];
    const rhs = node.children[2]; // skip '=' at index 1
    if (!lhs || !rhs) return;

    const name = lhs.text;
    const value = rhs.text;
    const startLine = exprStmt.startPosition.row + 1;
    const endLine = exprStmt.endPosition.row + 1;
    const startColumn = exprStmt.startPosition.column;
    const endColumn = exprStmt.endPosition.column;

    const decl = GradleDeclaration.builder(
      GradleDeclarationType.PROPERTY, name, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(value)
      .withQualifier(this.propertyScopeFor(name, parentBlockHash, false))
      .build();

    this.extractedDeclarations.push(decl);
    this.extractValueReferences(rhs, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);

    // Decompose Groovy map literals: versions = [awsSdk: '2.21.29', ...] → individual properties
    this.decomposeMapLiteral(name, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, dialect, serviceVersionHash, startLine);
  }

  // ─── Local Variable Declaration ─────────────────────────────────

  /**
   * Processes a local variable declaration: def x = value → PROPERTY declaration.
   * AST: local_variable_declaration → [def, variable_declarator → [identifier, =, value]]
   */
  private processLocalVariableDeclaration(
    node: Parser.SyntaxNode,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string
  ): void {
    // Find the variable_declarator child
    const declarator = node.children.find(c => c.type === 'variable_declarator');
    if (!declarator) return;

    const nameNode = declarator.children.find(c => c.type === 'identifier');
    // Value is child after '='
    const eqIndex = declarator.children.findIndex(c => c.type === '=');
    const valueNode = eqIndex >= 0 ? declarator.children[eqIndex + 1] : null;

    if (!nameNode) return;

    const name = nameNode.text;
    const value = valueNode ? valueNode.text : '';
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    const decl = GradleDeclaration.builder(
      GradleDeclarationType.PROPERTY, name, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(value)
      .withQualifier(this.propertyScopeFor(name, parentBlockHash, true))
      .build();

    this.extractedDeclarations.push(decl);
    if (valueNode) {
      this.extractValueReferences(valueNode, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
    }

    // Decompose Groovy map literals: def versions = [awsSdk: '2.21.29', ...] → individual properties
    this.decomposeMapLiteral(name, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, dialect, serviceVersionHash, startLine);
  }

  // ─── Map Literal Decomposition ─────────────────────────────────

  /**
   * Decomposes a Groovy map literal value into individual PROPERTY declarations.
   *
   *   versions = [awsSdk: '2.21.29', caffeine: '3.1.8']
   *     → PROPERTY versions.awsSdk  = '2.21.29'
   *     → PROPERTY versions.caffeine = '3.1.8'
   *
   * Each sub-property is linked to the parent property's hash.
   */
  private decomposeMapLiteral(
    parentName: string,
    value: string,
    _parentDeclHash: string,
    parentBlockHash: string,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    startLine: number
  ): void {
    const trimmed = value.trim();
    // Must look like a Groovy map literal: starts with [ and ends with ]
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return;
    // Exclude list literals like ['a', 'b'] (no colon-separated entries)
    if (!trimmed.includes(':')) return;

    const inner = trimmed.slice(1, -1); // strip [ ]

    // A LIST of maps is not a map, and decomposing one as if it were produces
    // a row per repeated key rather than a row per entry:
    //
    //     commonExcludes = [[group: 'a', module: 'x'], [group: 'b', module: 'y']]
    //
    // yields two `commonExcludes.group` properties with different values and
    // no way to tell which belonged to which element. Elasticsearch has one of
    // these with dozens of elements, and the collapsed rows collided on their
    // own key. A nested bracket is the signal, and the outer PROPERTY row
    // still carries the whole literal.
    if (inner.includes('[')) return;

    // Match key: value entries — value can be quoted string or bare identifier/number
    const entryPattern = /(\w+)\s*:\s*('[^']*'|"[^"]*"|[^,\]\n]+)/g;
    let match: RegExpExecArray | null;
    const seenKeys = new Set<string>();

    while ((match = entryPattern.exec(inner)) !== null) {
      const key = match[1];
      const val = (match[2] ?? '').trim();
      // Remove trailing comma if present
      const cleanVal = val.endsWith(',') ? val.slice(0, -1).trim() : val;
      const qualifiedName = `${parentName}.${key}`;

      // A duplicate key in one map literal is not two properties — Groovy
      // keeps the last. Emitting both produces two rows with one key.
      if (!key || seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Each entry gets its own offset so entries on the same line stay
      // distinct rows rather than colliding on a shared 0:0 position.
      const before = inner.slice(0, match.index);
      const entryLine = startLine + (before.match(/\n/g) || []).length;
      const lastNl = before.lastIndexOf('\n');
      const entryColumn = lastNl < 0 ? match.index : match.index - lastNl - 1;

      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PROPERTY, qualifiedName, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, entryLine, entryLine,
        entryColumn, entryColumn + match[0].length,
        serviceVersionHash
      )
        .withValue(cleanVal)
        // The scope, not the parent map's name: the qualifier column is the
        // scope for every other PROPERTY row and a consumer reading it should
        // not get a variable name from this one shape. The parent is already
        // recoverable from the qualified name's own prefix.
        .withQualifier(GradlePropertyScope.EXT_MAP_ENTRY)
        .build();

      this.extractedDeclarations.push(decl);
    }
  }

  // ─── Kotlin DSL Plugin Pattern ─────────────────────────────────

  /**
   * Attempts to process a Kotlin DSL plugin declaration:
   *   id("org.springframework.boot") version "3.1.5" [apply false]
   *
   * tree-sitter-groovy splits this across sibling nodes:
   *   [juxt_function_call] id("...") version    ← current node
   *   [expression_statement] "3.1.5"            ← next sibling (version value)
   *   --- or for apply false: ---
   *   [juxt_function_call] "1.0" apply          ← version + apply keyword
   *   [expression_statement] false              ← apply value
   *
   * @returns Number of extra siblings consumed (0 if not a plugin pattern).
   */
  private tryProcessPluginIdDeclaration(
    node: Parser.SyntaxNode,
    siblings: Parser.SyntaxNode[],
    index: number,
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string
  ): number {
    // Pattern: juxt_function_call → [method_invocation(id/kotlin, args), argument_list(version)]
    const methodInvocation = node.children.find(c => c.type === 'method_invocation');
    if (!methodInvocation) return 0;

    const idName = this.getMethodName(methodInvocation);
    if (idName !== 'id' && idName !== 'kotlin') return 0;

    // Check that the argument_list of the juxt_function_call contains 'version'
    const outerArgList = node.children.find(c => c.type === 'argument_list');
    if (!outerArgList) return 0;
    const hasVersion = outerArgList.children.some(c => c.type === 'identifier' && c.text === 'version');
    if (!hasVersion) return 0;

    // Extract plugin ID from the method invocation's arguments
    const pluginIdRaw = this.getArgumentsText(methodInvocation);
    const pluginId = this.stripQuotes(pluginIdRaw);

    // Look ahead for version value
    let versionValue = '';
    let applyFalse = false;
    let consumed = 0;
    let endLine = node.endPosition.row + 1;
    let endColumn = node.endPosition.column;

    const nextSibling = index + 1 < siblings.length ? siblings[index + 1] : null;
    if (nextSibling) {
      if (nextSibling.type === 'expression_statement') {
        // Simple: id("...") version "3.1.5"
        //   next sibling is expression_statement containing the version string
        const inner = nextSibling.children[0];
        versionValue = inner ? this.stripQuotes(inner.text) : '';
        endLine = nextSibling.endPosition.row + 1;
        endColumn = nextSibling.endPosition.column;
        consumed = 1;
      } else if (nextSibling.type === 'juxt_function_call') {
        // Complex: id("...") version "1.0" apply false
        //   next sibling is juxt_function_call: "1.0" apply
        //   sibling after that is expression_statement: false
        const strChild = nextSibling.children.find(
          c => c.type === 'string_literal' || c.type === 'character_literal'
        );
        const applyArgList = nextSibling.children.find(c => c.type === 'argument_list');
        const hasApply = applyArgList?.children.some(c => c.type === 'identifier' && c.text === 'apply');

        if (strChild && hasApply) {
          versionValue = this.stripQuotes(strChild.text);
          consumed = 1;
          endLine = nextSibling.endPosition.row + 1;
          endColumn = nextSibling.endPosition.column;

          // Consume the apply value (false)
          const applyValueSibling = index + 2 < siblings.length ? siblings[index + 2] : null;
          if (applyValueSibling?.type === 'expression_statement') {
            applyFalse = applyValueSibling.text.trim() === 'false' || applyValueSibling.text.trim().includes('false');
            endLine = applyValueSibling.endPosition.row + 1;
            endColumn = applyValueSibling.endPosition.column;
            consumed = 2;
          }
        }
      }
    }

    const startLine = node.startPosition.row + 1;
    const startColumn = node.startPosition.column;

    const decl = GradleDeclaration.builder(
      GradleDeclarationType.PLUGIN, pluginId, dialect, parentBlockHash,
      this.scriptHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(versionValue)
      .withQualifier(idName)
      .withNotation(GradlePluginSyntax.PLUGINS_BLOCK_ID)
      .withHasConfigBlock(applyFalse)
      .build();

    this.extractedDeclarations.push(decl);
    // Scan plugin name + version for value references (e.g., version from variable)
    this.extractValueReferences(node, pluginId + ' ' + versionValue, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
    return consumed;
  }

  private isSettingsScript(): boolean {
    return this.scriptKind === GradleScriptKind.SETTINGS
      || this.scriptKind === GradleScriptKind.BUILD_SRC_SETTINGS;
  }

  /**
   * Gradle accepts `include 'core'` and `include ':core'` as the same project.
   * The relation stores the canonical colon-prefixed form so that a settings
   * include and a `project(':core')` dependency join on equal strings — most
   * real settings files use the bare form and every dependency uses the other.
   */
  private normalizeProjectPath(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith(':')) return trimmed;
    // A path with a separator is a directory spec, not a project name.
    if (trimmed.includes('/') || trimmed.includes('\\')) return '';
    return ':' + trimmed;
  }

  /**
   * Strips surrounding single or double quotes from a string.
   */
  private stripQuotes(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }

  // ─── Value Reference Resolution ────────────────────────────────

  /**
   * Links each value reference to the PROPERTY declaration it names, within
   * this file, and records what kind of link that was.
   *
   * ## Why the unresolved cases are split rather than left blank
   *
   * A reference this pass cannot match is not necessarily a miss. Some
   * references have nothing in the corpus to match by construction —
   * `System.getenv('CI')` names an environment variable, and no build file
   * anywhere declares it. Others name a property that IS declared somewhere
   * and simply was not linked, which is the parser's own gap.
   *
   * Marking both `UNRESOLVED` would make the coverage number track how many
   * environment variables a build reads. So the reference types that can never
   * resolve to a declaration are marked EXTERNAL here and excluded from
   * coverage, and everything else is left UNRESOLVED_IN_CORPUS for the project
   * pass, which sees the other files and can still resolve it.
   */
  private resolveValueReferences(): void {
    const propertyMap = new Map<string, GradleDeclaration>();
    for (const decl of this.extractedDeclarations) {
      if (decl.getDeclarationType() === GradleDeclarationType.PROPERTY) {
        propertyMap.set(decl.getName(), decl);
      }
    }

    for (const ref of this.extractedValueReferences) {
      // Reads of the environment, of system properties, and of properties
      // supplied on the command line. Nothing in any build file declares
      // these, so an empty target is the correct and final answer.
      if (GradleFileExtractor.ALWAYS_EXTERNAL_REFS.has(ref.getReferenceType())) {
        ref.setResolution(GradleReferenceResolution.EXTERNAL);
        continue;
      }

      const expr = ref.getReferenceExpression();

      const direct = propertyMap.get(expr);
      if (direct) {
        ref.setResolution(this.scopeOf(direct), direct.getHash());
        continue;
      }

      // `versions.awsSdk` resolves to the `versions` map when the map itself
      // was decomposed; the decomposed entry is preferred when present because
      // it carries the actual version rather than the whole literal.
      const dotIndex = expr.indexOf('.');
      if (dotIndex > 0) {
        const head = expr.substring(0, dotIndex);
        const owner = propertyMap.get(head);
        if (owner) {
          ref.setResolution(this.scopeOf(owner), owner.getHash());
          continue;
        }
        // `rootProject.foo` names a property of another script.
        if (head === 'rootProject' || head === 'project') {
          ref.setResolution(GradleReferenceResolution.UNRESOLVED_IN_CORPUS);
          continue;
        }
      }

      // Left for the project pass, which can see the other scripts and the
      // version catalogs. Concluding EXTERNAL here would freeze the weaker
      // answer produced by the less informed pass.
      ref.setResolution(GradleReferenceResolution.UNRESOLVED_IN_CORPUS);
    }
  }

  /** Reference kinds that read something no build file can declare. */
  private static readonly ALWAYS_EXTERNAL_REFS: ReadonlySet<GradleValueReferenceType> = new Set([
    GradleValueReferenceType.SYSTEM_PROPERTY,
    GradleValueReferenceType.ENV_VARIABLE,
    GradleValueReferenceType.ENV_VARIABLE_SHORT,
    GradleValueReferenceType.SYSTEM_PROPERTY_PROVIDER,
    GradleValueReferenceType.ENV_VARIABLE_PROVIDER,
    GradleValueReferenceType.FILE_READ,
  ]);

  /** EXT_PROPERTY when the property came from an ext block, LOCAL otherwise. */
  private scopeOf(decl: GradleDeclaration): GradleReferenceResolution {
    const scope = decl.getQualifier();
    return (scope === GradlePropertyScope.EXT_BLOCK
      || scope === GradlePropertyScope.EXT_SINGLE
      || scope === GradlePropertyScope.EXT_SET
      || scope === GradlePropertyScope.BUILDSCRIPT_EXT
      || scope === GradlePropertyScope.EXT_MAP_ENTRY)
      ? GradleReferenceResolution.EXT_PROPERTY
      : GradleReferenceResolution.LOCAL_PROPERTY;
  }

  // ─── Dependency Coordinates ────────────────────────────────────

  /**
   * Splits every DEPENDENCY declaration into coordinate rows.
   *
   * Runs after restoration so an interpolated coordinate is split on its real
   * text — `"com.example:lib:${springVersion}"` rather than
   * `"com.example:lib:__INTERP__"`. Splitting the placeholder would report a
   * literal version of `__INTERP__` on every interpolated dependency in the
   * corpus.
   */
  private extractCoordinates(): void {
    for (const decl of this.extractedDeclarations) {
      if (decl.getDeclarationType() !== GradleDeclarationType.DEPENDENCY) continue;

      const configuration = decl.getQualifier();
      const parsed = DependencyCoordinateParser.parse(decl.getValue() || decl.getName());

      for (const c of parsed) {
        this.extractedCoordinates.push(
          GradleDependencyCoordinate.builder(
            configuration,
            c.notation,
            decl.getHash(),
            decl.getParentBlockHash(),
            this.scriptHash,
            this.filePath,
            this.baseMservPath,
            decl.getStartLine(),
            decl.getEndLine(),
            this.serviceVersionHash
          )
            .withGroup(c.group)
            .withArtifact(c.artifact)
            .withVersion(c.version)
            .withClassifier(c.classifier)
            .withExtension(c.extension)
            .withVersionSource(c.versionSource)
            .withProjectPath(c.projectPath)
            .withFileSpec(c.fileSpec)
            .withCatalogAlias(c.catalogAlias)
            .withHasConfigBlock(decl.getHasConfigBlock())
            // A literal version needs no resolution, so it is its own resolved
            // value. An interpolated or catalog one stays empty until the
            // project pass actually finds what it points at.
            .withResolvedVersion(
              c.versionSource === GradleVersionSource.LITERAL ? c.version : ''
            )
            .build()
        );

        // A catalog accessor is a reference to something outside this file, so
        // it belongs in the reference relation too. Without a row here, the
        // only trace of `implementation libs.spring.core` in that relation is
        // nothing at all, and a coverage pass would count the build as having
        // no unresolved references while every coordinate in it is empty.
        if (c.catalogAlias) {
          this.extractedValueReferences.push(
            GradleValueReference.builder(
              c.catalogAlias,
              c.notation === GradleDependencyNotation.VERSION_CATALOG_BUNDLE
                ? GradleValueReferenceType.VERSION_CATALOG_BUNDLE
                : GradleValueReferenceType.VERSION_CATALOG_ACCESSOR,
              decl.getValue() || decl.getName(),
              this.scriptHash,
              this.filePath, this.baseMservPath,
              decl.getStartLine(), decl.getEndLine(),
              decl.getStartColumn(), decl.getEndColumn(),
              this.serviceVersionHash
            )
              .withOwnerDeclarationHash(decl.getHash())
              .withOwnerBlockHash(decl.getParentBlockHash())
              .withResolutionKind(GradleReferenceResolution.UNRESOLVED_IN_CORPUS)
              .build()
          );
        }
      }
    }
  }

  /**
   * Emits a REPOSITORY row for `maven { }`, `ivy { }` and `flatDir { }`.
   *
   * These are the only repositories that are blocks rather than calls, so the
   * shortcut path — which matches `mavenCentral()` and friends by method name —
   * never saw them. The effect was that a build declaring nothing but a custom
   * Maven repository produced no repository rows at all, which reads
   * downstream as a build that resolves from nowhere.
   */
  private static readonly REPOSITORY_BLOCK_TYPES: Record<string, GradleRepositoryType> = {
    'maven': GradleRepositoryType.MAVEN_CUSTOM,
    'ivy': GradleRepositoryType.IVY,
    'flatDir': GradleRepositoryType.FLAT_DIR,
    'exclusiveContent': GradleRepositoryType.EXCLUSIVE_CONTENT,
  };

  private emitRepositoryBlockDeclaration(
    block: GradleBlock,
    blockName: string,
    dialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const repoType = GradleFileExtractor.REPOSITORY_BLOCK_TYPES[blockName];
    if (!repoType) return;
    if (!this.isWithin(block.getParentBlockHash(), GradleBlockType.REPOSITORIES)) return;

    // The URL lives in a `url` declaration inside the block, which has not
    // been walked yet. Read it off the original source instead, which also
    // survives the case where the block's contents failed to parse.
    const url = this.findUrlInLines(block.getStartLine(), block.getEndLine());

    this.extractedDeclarations.push(
      GradleDeclaration.builder(
        GradleDeclarationType.REPOSITORY, url || blockName, dialect,
        block.getHash(), this.scriptHash,
        filePath, baseMservPath,
        block.getStartLine(), block.getEndLine(),
        block.getStartColumn(), block.getEndColumn(),
        serviceVersionHash
      )
        .withValue(url)
        .withNotation(repoType)
        .withQualifier(blockName)
        .withHasConfigBlock(true)
        .build()
    );
  }

  /** First `url`/`setUrl` value in a line range of the original source. */
  private findUrlInLines(startLine: number, endLine: number): string {
    for (let i = startLine - 1; i < endLine && i < this.originalLines.length; i++) {
      const line = this.originalLines[i];
      if (!line) continue;
      const m = /\b(?:url|setUrl)\s*[=(]?\s*(?:uri\s*\()?\s*['"]([^'"]+)['"]/.exec(line);
      if (m) return m[1] ?? '';
    }
    return '';
  }

  // ─── Apply Statement ───────────────────────────────────────────

  /**
   * Processes apply plugin: 'x' or apply from: 'path'.
   */
  private processApplyStatement(
    node: Parser.SyntaxNode,
    args: string,
    dialect: GradleDSLDialect,
    filePath: string,
    baseMservPath: string,
    startLine: number,
    endLine: number,
    startColumn: number,
    endColumn: number,
    serviceVersionHash: string,
    parentBlockHash: string
  ): void {
    const fullText = node.text;

    if (fullText.includes('plugin:')) {
      const pluginName = this.extractStringLiteral(args.replace(/plugin\s*:\s*/, ''));
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PLUGIN, pluginName, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withNotation(GradlePluginSyntax.APPLY_PLUGIN_STRING)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, pluginName, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
    } else if (fullText.includes('from:')) {
      const fromPath = this.extractStringLiteral(args.replace(/from\s*:\s*/, ''));
      const isRemote = fromPath.startsWith('http://') || fromPath.startsWith('https://');
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PLUGIN, fromPath, dialect, parentBlockHash,
        this.scriptHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withNotation(isRemote ? GradlePluginSyntax.APPLY_FROM_REMOTE : GradlePluginSyntax.APPLY_FROM_LOCAL)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, fromPath, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
    }
  }

  // ─── Control Flow ──────────────────────────────────────────────

  /**
   * Processes a control flow statement (if, for, while, etc.).
   */
  private processControlFlow(
    node: Parser.SyntaxNode,
    blockType: GradleBlockType,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    const expression = this.extractConditionExpression(node);

    const block = GradleBlock.builder(
      blockType,
      depth,
      dialect,
      this.scriptHash,
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      serviceVersionHash
    )
      .withExpression(expression)
      .withParentBlockHash(parentBlockHash)
      .build();

    this.registerBlock(block);

    blocks.push(block);

    // Walk the body of the control flow
    const body = this.findChildByType(node, 'block') || this.findChildByType(node, 'closure');
    if (body) {
      this.walkNode(
        body, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, block.getHash(), depth + 1
      );
    }

    // Handle else/else-if branches for if statements
    if (blockType === GradleBlockType.IF) {
      this.processElseBranches(
        node, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, parentBlockHash, depth
      );
    }
  }

  /**
   * Processes else and else-if branches of an if statement.
   */
  private processElseBranches(
    ifNode: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    // tree-sitter-groovy represents else as an alternative child
    for (const child of ifNode.children) {
      if (child.type === 'else_clause' || child.type === 'else') {
        const innerIf = this.findChildByType(child, 'if_statement');
        if (innerIf) {
          // else if — flatten to ELSE_IF
          this.processControlFlow(
            innerIf, GradleBlockType.ELSE_IF, blocks, filePath,
            baseMservPath, dialect, serviceVersionHash, parentBlockHash, depth
          );
        } else {
          // standalone else
          const elseBody = this.findChildByType(child, 'block') || this.findChildByType(child, 'closure');
          if (elseBody) {
            const elseBlock = GradleBlock.builder(
              GradleBlockType.ELSE,
              depth,
              dialect,
              this.scriptHash,
              filePath,
              baseMservPath,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              child.startPosition.column,
              child.endPosition.column,
              serviceVersionHash
            )
              .withParentBlockHash(parentBlockHash)
              .build();

            this.registerBlock(elseBlock);

            blocks.push(elseBlock);

            this.walkNode(
              elseBody, blocks, filePath, baseMservPath, dialect,
              serviceVersionHash, elseBlock.getHash(), depth + 1
            );
          }
        }
      }
    }
  }

  // ─── Try/Catch/Finally ─────────────────────────────────────────

  /**
   * Processes try/catch/finally statements, linking them via tryStatementHash.
   */
  private processTryStatement(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    // Create the TRY block
    const tryBlock = GradleBlock.builder(
      GradleBlockType.TRY,
      depth,
      dialect,
      this.scriptHash,
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      serviceVersionHash
    )
      .withParentBlockHash(parentBlockHash)
      .build();

    this.registerBlock(tryBlock);

    blocks.push(tryBlock);
    const tryHash = tryBlock.getHash();

    // Walk try body
    const tryBody = this.findChildByType(node, 'block') || this.findChildByType(node, 'closure');
    if (tryBody) {
      this.walkNode(
        tryBody, blocks, filePath, baseMservPath, dialect,
        serviceVersionHash, tryHash, depth + 1
      );
    }

    // Process catch clauses
    for (const child of node.children) {
      if (child.type === 'catch_clause' || child.type === 'catch') {
        const caughtType = this.extractCaughtExceptionType(child);
        const catchBlock = GradleBlock.builder(
          GradleBlockType.CATCH,
          depth,
          dialect,
          this.scriptHash,
          filePath,
          baseMservPath,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column,
          serviceVersionHash
        )
          .withParentBlockHash(parentBlockHash)
          .withTryStatementHash(tryHash)
          .withCaughtExceptionTypes(caughtType)
          .build();

        this.registerBlock(catchBlock);

        blocks.push(catchBlock);

        const catchBody = this.findChildByType(child, 'block') || this.findChildByType(child, 'closure');
        if (catchBody) {
          this.walkNode(
            catchBody, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, catchBlock.getHash(), depth + 1
          );
        }
      }

      if (child.type === 'finally_clause' || child.type === 'finally') {
        const finallyBlock = GradleBlock.builder(
          GradleBlockType.FINALLY,
          depth,
          dialect,
          this.scriptHash,
          filePath,
          baseMservPath,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          child.startPosition.column,
          child.endPosition.column,
          serviceVersionHash
        )
          .withParentBlockHash(parentBlockHash)
          .withTryStatementHash(tryHash)
          .build();

        this.registerBlock(finallyBlock);

        blocks.push(finallyBlock);

        const finallyBody = this.findChildByType(child, 'block') || this.findChildByType(child, 'closure');
        if (finallyBody) {
          this.walkNode(
            finallyBody, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, finallyBlock.getHash(), depth + 1
          );
        }
      }
    }
  }

  // ─── Switch ────────────────────────────────────────────────────

  /**
   * Processes a switch statement: creates SWITCH parent + SWITCH_CASE children.
   */
  private processSwitchStatement(
    node: Parser.SyntaxNode,
    blocks: GradleBlock[],
    filePath: string,
    baseMservPath: string,
    dialect: GradleDSLDialect,
    serviceVersionHash: string,
    parentBlockHash: string,
    depth: number
  ): void {
    const expression = this.extractConditionExpression(node);

    const switchBlock = GradleBlock.builder(
      GradleBlockType.SWITCH,
      depth,
      dialect,
      this.scriptHash,
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      node.startPosition.column,
      node.endPosition.column,
      serviceVersionHash
    )
      .withExpression(expression)
      .withParentBlockHash(parentBlockHash)
      .build();

    this.registerBlock(switchBlock);

    blocks.push(switchBlock);

    // Walk through switch body looking for case clauses
    const switchBody = this.findChildByType(node, 'switch_block') || this.findChildByType(node, 'block');
    if (switchBody) {
      for (const child of switchBody.children) {
        if (child.type === 'switch_block_statement_group' || child.type === 'case_clause' || child.type === 'default_clause') {
          const caseLabel = this.extractCaseLabel(child);
          const caseBlock = GradleBlock.builder(
            GradleBlockType.SWITCH_CASE,
            depth + 1,
            dialect,
            this.scriptHash,
            filePath,
            baseMservPath,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            child.startPosition.column,
            child.endPosition.column,
            serviceVersionHash
          )
            .withBlockName(caseLabel)
            .withParentBlockHash(switchBlock.getHash())
            .build();

          this.registerBlock(caseBlock);

          blocks.push(caseBlock);

          this.walkNode(
            child, blocks, filePath, baseMservPath, dialect,
            serviceVersionHash, caseBlock.getHash(), depth + 2
          );
        }
      }
    }
  }

  // ─── Helper Methods ────────────────────────────────────────────

  /**
   * Pre-processes source to strip Kotlin type annotations that tree-sitter-groovy
   * cannot parse (e.g., `String`, `String?`, `Map<String, String>`).
   *
   * Transforms:
   *   val name: String = value       → val name = value
   *   val name: String? = value      → val name = value
   *   val name: String by delegate   → val name by delegate
   *   val name: Map<K,V> = value     → val name = value
   *
   * Only applies to val/var declarations. Preserves line numbers (no line removal).
   */
  private stripKotlinTypeAnnotations(source: string): string {
    // Match val/var name: Type[?] [=|by]
    // The type can be simple (String) or generic (Map<String, List<Int>>)
    // We need to handle nested angle brackets for generics
    // Not a gap: the declared type is redundant with the initialiser for
    // every shape this parser reports on, and the PROPERTY row keeps the value.
    return this.rewrite(
      source,
      /\b(val|var)\s+(\w+)\s*:\s*[A-Z]\w*(?:<[^>]*>)?\??\s*(=|by)\s/g,
      (m) => `${m[1]} ${m[2]} ${m[3]} `,
      null
    );
  }

  /**
   * Pre-processes source to convert Kotlin delegated property syntax to
   * simple assignments that tree-sitter-groovy can parse.
   *
   * Transforms:
   *   val name by extra("value")   → val name = extra("value")
   *   val name by project           → val name = project
   *   val name by extra { ... }     → val name = extra { ... }
   *
   * Must run AFTER stripKotlinTypeAnnotations (which already converts
   * `val name: Type by delegate` → `val name by delegate`).
   */
  private stripKotlinByDelegation(source: string): string {
    return this.rewrite(
      source,
      /\b(val|var)\s+(\w+)\s+by\s+/g,
      (m) => `${m[1]} ${m[2]} = `,
      null
    );
  }

  /**
   * Replaces GString interpolation blocks ${...} with a safe placeholder.
   * tree-sitter-groovy does not support GString interpolation and treats
   * the { inside ${} as a block-opening brace, which corrupts all
   * subsequent brace matching in the file.
   *
   * Transforms:
   *   "Bearer ${System.getenv("TOKEN")}"  →  "Bearer __INTERP__"
   *   "guava:${guavaVersion}"             →  "guava:__INTERP__"
   */
  private normalizeGStringInterpolation(source: string): string {
    // Round-trips: restorePreprocessedValues puts the original ${...} back,
    // and extractRestoredGStringRefs then reads the references out of it.
    // `[^}]` matches newlines on purpose — a multi-line interpolation still
    // has to be neutralised — and rewrite() carries the newlines forward so
    // nothing below it shifts.
    return this.rewrite(source, /\$\{[^}]+\}/g, () => '__INTERP__', null);
  }

  /**
   * Strips parenthesized arguments before trailing closures for non-keyword
   * identifiers. tree-sitter-groovy cannot parse `method(args) { closure }`
   * correctly — it fails to associate the closure with the method call.
   *
   * Transforms:
   *   credentials(HttpHeaderCredentials) {  →  credentials {
   *   task('hello', type: Copy) {           →  task {
   *
   * Control flow keywords (if, for, while, etc.) are excluded.
   */
  private stripTrailingClosureArgs(source: string): string {
    // Round-trips: the args are stashed per line and recovered by
    // recoverStrippedClosureArgs when the block is built, so nothing is lost.
    return this.rewrite(
      source,
      // The receiver is captured too. `tasks.register('x', Copy) { }` is a
      // task and a bare `register('x') { }` on some other object is not, and
      // the two are indistinguishable once the `tasks.` is dropped.
      /(?:^|[^\w.])([A-Za-z_][\w.]*)\([^)\n]*\)[^\S\n]*\{/gm,
      (m) => {
        const match = m[0];
        const name = m[1] ?? '';
        const leading = match.slice(0, match.indexOf(name));
        if (GradleFileExtractor.CONTROL_FLOW_KEYWORDS.has(name)) return match;
        if (name.split('.').some((seg) => GradleFileExtractor.CONTROL_FLOW_KEYWORDS.has(seg))) return match;
        // From the name's own offset, not the match's: the leading character
        // the pattern consumes to prove the name is unqualified is often the
        // preceding newline, which would file the args under the line above.
        const lineNumber = this.lineOf(source, m.index + leading.length);
        const openParen = match.indexOf('(');
        const closeParen = match.lastIndexOf(')');
        if (openParen >= 0 && closeParen > openParen) {
          this.strippedClosureArgs.set(lineNumber, {
            methodName: name,
            args: match.substring(openParen + 1, closeParen),
          });
        }
        return leading + name + ' {';
      },
      null
    );
  }

  private static readonly CONTROL_FLOW_KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'catch', 'try', 'finally', 'synchronized',
  ]);

  /**
   * Strips Groovy closure parameter declarations so tree-sitter-groovy can
   * parse the closure body.  Without this, `{ project -> ... }` produces an
   * ERROR node and everything inside becomes an unparseable blob.
   *
   * Transforms:
   *   { project ->          →  {
   *   { key, value ->       →  {
   *   { DependencyDetails details ->  →  {
   */
  private stripClosureParameters(source: string): string {
    // Match: { <optional whitespace> <identifiers with optional types> ->
    // Handles: { x -> , { a, b -> , { Type x -> , { Type x, Type y ->
    // LOSSY: the parameter names are gone and nothing recovers them, so a
    // consumer reading `configurations.each { }` cannot tell what the closure
    // called its argument. Recorded as a gap for exactly that reason.
    return this.rewrite(
      source,
      /\{([ \t]*)(?:[A-Z]\w+\s+)?\w+(?:\s*,\s*(?:[A-Z]\w+\s+)?\w+)*\s*->/g,
      (m) => '{' + (m[1] ?? ''),
      GradleParseGapReason.DROPPED_CLOSURE_PARAMETERS
    );
  }

  /**
   * Replaces the Groovy/Kotlin Elvis operator (?:) with logical OR (||).
   * tree-sitter-groovy cannot parse ?:, producing malformed nodes that
   * extend to end-of-file.
   *
   * Transforms:
   *   findProperty('x') ?: 'default'  →  findProperty('x') || 'default'
   */
  private normalizeElvisOperator(source: string): string {
    // LOSSY: `a ?: b` and `a || b` are different operators — the first yields
    // `a` when it is truthy, the second yields `true` — so any consumer
    // reading the rewritten expression text is reading something the build
    // never said. The default-value column on the reference relation carries
    // the part that matters; the gap row says where the rest went.
    return this.rewrite(source, /\?:/g, () => '||', GradleParseGapReason.REWRITTEN_ELVIS);
  }

  /**
   * Replaces empty single-quoted string literals '' with '_EMPTY_'.
   * tree-sitter-groovy uses character_literal for single-quoted strings
   * and cannot parse '' (empty) — it produces an ERROR node that spans
   * to end-of-file, corrupting all subsequent block parsing.
   *
   * Uses negative lookahead/lookbehind to avoid matching inside triple-
   * quoted strings (''').
   *
   * Transforms:
   *   project.findProperty('x') || ''  →  project.findProperty('x') || '_EMPTY_'
   */
  private normalizeEmptyStringLiterals(source: string): string {
    // Round-trips: restorePreprocessing turns '_EMPTY_' back into ''.
    return this.rewrite(source, /(?<!')''(?!')/g, () => "'_EMPTY_'", null);
  }

  /**
   * Replaces non-ASCII characters (e.g. em-dash —, box-drawing ─) with _.
   * tree-sitter-groovy cannot handle multi-byte UTF-8 characters and will
   * produce ERROR nodes that cascade through the rest of the file.
   */
  private stripNonAsciiCharacters(source: string): string {
    // LOSSY: a non-ASCII character inside a string literal — a repository name,
    // a comment marker, a licence header — becomes `_` in every emitted value.
    // Runs of them are collapsed into one gap so a box-drawing banner does not
    // produce sixty rows.
    return this.rewrite(
      source,
      /[^\x00-\x7F]+/g,
      (m) => '_'.repeat(m[0].length),
      GradleParseGapReason.REPLACED_NON_ASCII
    );
  }

  /**
   * Converts single-quoted values in named parameter syntax to double-quoted.
   * tree-sitter-groovy cannot parse `method(key: 'value')` inside a closure
   * but handles `method(key: "value")` correctly.
   *
   * Transforms:
   *   project(path: ':shared')  →  project(path: ":shared")
   *   exclude group: 'org.x'   →  exclude group: "org.x"
   */
  private convertNamedParamQuotes(source: string): string {
    // Round-trips: only the quote character changes, and the value is read back
    // from inside it either way.
    return this.rewrite(
      source,
      /(\w+\s*:\s*)'([^'\n]*)'/g,
      (m) => `${m[1]}"${m[2]}"`,
      null
    );
  }

  /**
   * Wraps dependency wrapper function calls in parentheses so tree-sitter-groovy
   * parses them as method invocations instead of splitting the wrapper name
   * from its argument list.
   *
   * tree-sitter-groovy parses `implementation files('a.jar', 'b.jar')` as
   * juxt_function_call(implementation, files) + a separate parenthesized
   * expression ('a.jar', 'b.jar') which produces an ERROR node that cascades
   * through the rest of the enclosing block.
   *
   * Uses balanced-paren counting to find the matching close paren, supporting
   * nested calls like testFixtures(project(':core')).
   *
   * Transforms:
   *   implementation files('a.jar', 'b.jar')  →  implementation(files('a.jar', 'b.jar'))
   *   implementation platform('org:art:1.0')  →  implementation(platform('org:art:1.0'))
   *   testImpl testFixtures(project(':core')) →  testImpl(testFixtures(project(':core')))
   */
  private normalizeDependencyWrapperCalls(source: string): string {
    const depConfigs = GradleFileExtractor.DEPENDENCY_CONFIGS;
    const wrappers = GradleFileExtractor.DEPENDENCY_WRAPPER_FUNCTIONS;
    const pattern = /\b(\w+)\s+(\w+)\s*\(/g;

    let result = '';
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(source)) !== null) {
      const configName = match[1]!;
      const wrapperName = match[2]!;
      if (!depConfigs.has(configName) || !wrappers.has(wrapperName)) continue;

      // Find matching close paren with balanced counting
      const openParenPos = match.index + match[0].length - 1;
      let depth = 1;
      let closePos = -1;
      for (let j = openParenPos + 1; j < source.length; j++) {
        if (source[j] === '(') depth++;
        if (source[j] === ')') {
          depth--;
          if (depth === 0) { closePos = j; break; }
        }
      }

      if (closePos < 0) continue;

      // Transform: configName wrapperFunc(...) → configName(wrapperFunc(...))
      const configEnd = match.index + configName.length;
      const inner = source.substring(configEnd, closePos + 1);
      // Leading whitespace is dropped but its newlines are kept: trimming them
      // away would shift every position below this call by however many lines
      // the wrapper spanned.
      const newlines = (inner.slice(0, inner.length - inner.trimStart().length).match(/\n/g) || []).length;
      result += source.substring(lastIndex, configEnd);
      result += '(';
      result += inner.trimStart() + '\n'.repeat(newlines);
      result += ')';
      lastIndex = closePos + 1;
      pattern.lastIndex = closePos + 1;
    }

    result += source.substring(lastIndex);
    return result;
  }

  /**
   * Wraps a bare version catalog accessor in parentheses.
   *
   * tree-sitter-groovy splits `implementation libs.spring.boot.starter.web`
   * into `juxt_function_call(implementation, libs)` and a separate
   * `expression_statement(spring.boot.starter.web)`. The dependency row that
   * falls out of that names `libs` — every catalog dependency in the corpus
   * collapsing to the same meaningless coordinate — and the rest of the
   * accessor becomes an unrelated statement.
   *
   * Wrapping it makes the grammar read one method invocation, which is the
   * same shape it already handles for `implementation project(':core')`.
   *
   * Round-trips: only parentheses are added, and the accessor text inside them
   * is untouched, so nothing is lost and no gap is warranted.
   *
   * Anchored to end-of-line and restricted to pure dotted identifiers so it
   * cannot touch `implementation group: 'x', name: 'y'` (has a colon),
   * `implementation project(':a')` (has parens), or a trailing closure.
   */
  private normalizeCatalogAccessorCalls(source: string): string {
    const configs = GradleFileExtractor.DEPENDENCY_CONFIGS;
    return this.rewrite(
      source,
      /^([ \t]*)([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)[ \t]*$/gm,
      (m) => {
        const config = m[2] ?? '';
        if (!configs.has(config)) return m[0];
        return `${m[1]}${config}(${m[3]})`;
      },
      null
    );
  }

  /**
   * Strips Kotlin ::class references that tree-sitter-groovy cannot parse.
   *
   * Transforms:
   *   HttpHeaderCredentials::class  →  HttpHeaderCredentials
   *   String::class.java            →  String
   */
  private stripKotlinClassReferences(source: string): string {
    // LOSSY: `Foo::class.java` becomes `Foo`, so the fact that the build named
    // a class literal rather than a value is gone from every emitted row.
    return this.rewrite(
      source,
      /(::\w+)(\.\w+)?/g,
      () => '',
      GradleParseGapReason.DROPPED_CLASS_REFERENCE
    );
  }

  /**
   * Strips inline generic type parameters on method calls that
   * tree-sitter-groovy cannot parse.
   *
   * Transforms:
   *   create<HttpHeaderAuthentication>("header")  →  create("header")
   *   listOf<String>()                            →  listOf()
   */
  private stripKotlinInlineGenerics(source: string): string {
    // LOSSY, and it costs a real fact: `tasks.register<Copy>("docs")` loses the
    // task type, which is the one thing that distinguishes it from every other
    // registered task. The gap row keeps the original text so the type is at
    // least recoverable by hand.
    return this.rewrite(
      source,
      /(\w+)<[^>]+>\s*\(/g,
      (m) => `${m[1]}(`,
      GradleParseGapReason.DROPPED_TYPE_ARGUMENTS
    );
  }

  /**
   * Strips Kotlin type casts (as Type / as Type?) that confuse
   * tree-sitter-groovy, especially nullable casts.
   *
   * Transforms:
   *   findProperty("x") as String? ?: "default"  →  findProperty("x")  ?: "default"
   *   value as Int                                →  value
   */
  private stripKotlinTypeCasts(source: string): string {
    // LOSSY, and over-eager: the pattern matches any ` as Word` sequence, so a
    // Groovy string containing the English word "as" followed by a capitalised
    // word is rewritten too. The gap row is what makes that visible rather
    // than silent.
    return this.rewrite(
      source,
      /\s+as\s+\w+(?:<[^>]*>)?\??/g,
      () => '',
      GradleParseGapReason.DROPPED_TYPE_CAST
    );
  }

  /**
   * Detects Groovy vs Kotlin DSL dialect from file extension.
   */
  private detectDialect(filePath: string): GradleDSLDialect {
    return filePath.endsWith('.kts') ? GradleDSLDialect.KOTLIN : GradleDSLDialect.GROOVY;
  }

  /**
   * Extracts the base microservice/project path from the file path.
   * Looks for common project root markers.
   */
  private extractBaseMservPath(filePath: string): string {
    // Walk up from file to find a directory containing build.gradle or settings.gradle
    const parts = filePath.split('/');
    for (let i = parts.length - 2; i >= 0; i--) {
      // Return the directory containing this gradle file
      if (parts[i + 1]?.endsWith('.gradle') || parts[i + 1]?.endsWith('.gradle.kts')) {
        return parts.slice(0, i + 1).join('/');
      }
    }
    return filePath;
  }

  /**
   * Gets the method name from a method_invocation node.
   */
  private getMethodName(node: Parser.SyntaxNode): string {
    // Try named children first
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
      if (child.type === 'property_expression' || child.type === 'member_access') {
        return child.text;
      }
    }
    // Fallback: first child text
    return node.children[0]?.text || '';
  }

  /**
   * Gets the first identifier from a node.
   */
  private getFirstIdentifier(node: Parser.SyntaxNode): string {
    for (const child of node.children) {
      if (child.type === 'identifier') {
        return child.text;
      }
    }
    return node.children[0]?.text || '';
  }

  /**
   * Finds the first child of a specific type.
   */
  private findChildByType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | undefined {
    for (const child of node.children) {
      if (child.type === type) {
        return child;
      }
    }
    return undefined;
  }

  /**
   * Gets arguments text from a method invocation.
   */
  private getArgumentsText(node: Parser.SyntaxNode): string {
    const argList = this.findChildByType(node, 'argument_list') || this.findChildByType(node, 'arguments');
    if (argList) {
      // Strip surrounding parentheses
      const text = argList.text;
      if (text.startsWith('(') && text.endsWith(')')) {
        return text.slice(1, -1).trim();
      }
      return text.trim();
    }
    return '';
  }

  /**
   * Gets the argument portion of an application expression.
   * In `implementation 'guava:...'`, returns `'guava:...'`
   */
  private getApplicationArgText(node: Parser.SyntaxNode): string {
    const children = node.children;
    if (children.length > 1) {
      // Skip the first identifier (method name), collect the rest
      return children.slice(1)
        .map(c => c.text)
        .join(' ')
        .trim();
    }
    return '';
  }

  /**
   * Extracts the condition/expression from a parenthesized expression.
   */
  private extractConditionExpression(node: Parser.SyntaxNode): string {
    const parenExpr = this.findChildByType(node, 'parenthesized_expression');
    if (parenExpr) {
      const text = parenExpr.text;
      if (text.startsWith('(') && text.endsWith(')')) {
        return text.slice(1, -1).trim();
      }
      return text;
    }
    return '';
  }

  /**
   * Extracts the caught exception type from a catch clause.
   */
  private extractCaughtExceptionType(node: Parser.SyntaxNode): string {
    // Look for the type in catch (ExceptionType e) { }
    for (const child of node.children) {
      if (child.type === 'catch_formal_parameter' || child.type === 'formal_parameter') {
        for (const param of child.children) {
          if (param.type === 'type_identifier' || param.type === 'identifier') {
            return param.text;
          }
        }
      }
    }
    return '';
  }

  /**
   * Extracts the case label text from a switch case/default clause.
   */
  private extractCaseLabel(node: Parser.SyntaxNode): string {
    for (const child of node.children) {
      if (child.type === 'switch_label' || child.type === 'case') {
        // Get the value after 'case' keyword
        for (const labelChild of child.children) {
          if (labelChild.type !== 'case' && labelChild.type !== ':') {
            return labelChild.text;
          }
        }
      }
      if (child.type === 'default') {
        return 'default';
      }
    }
    return '';
  }

  /**
   * Strips surrounding quotes from a string literal.
   */
  private extractStringLiteral(text: string): string {
    const trimmed = text.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  // ─── Value Reference Extraction ─────────────────────────────

  /**
   * Scans a declaration's value text for GString interpolation references
   * and scans the AST node for method-based references (System.getenv, findProperty, etc.).
   *
   * Called after a declaration is created, so the declaration hash is available for linking.
   */
  private extractValueReferences(
    node: Parser.SyntaxNode,
    valueText: string,
    ownerDeclarationHash: string,
    ownerBlockHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    // 1. Scan for GString interpolation in the value text
    this.scanStringForGStringRefs(
      valueText, node, ownerDeclarationHash, ownerBlockHash,
      filePath, baseMservPath, serviceVersionHash
    );

    // 2. Scan AST for method-based value references
    this.scanNodeForMethodBasedRefs(
      node, ownerDeclarationHash, ownerBlockHash,
      filePath, baseMservPath, serviceVersionHash
    );
  }

  /**
   * Scans a string value for GString patterns: ${expr}, $var, ${-> expr}.
   */
  /**
   * Resolves where a matched fragment actually sits, rather than handing every
   * reference the whole enclosing node's range.
   *
   * That shortcut is not merely imprecise, it breaks identity. A reference's
   * key is its owner plus its byte range, so three `$ES_HOME` occurrences in
   * one 80-line declaration all produced the SAME key and collapsed into one
   * row — 88 collisions in Elasticsearch alone, each one a reference the
   * relation simply did not contain.
   *
   * The fragment is located inside the node's own text, with a cursor so the
   * second occurrence is found after the first rather than matching it again.
   * When it cannot be located — the scanned text was derived rather than taken
   * verbatim from the node — the ordinal keeps the key unique and the position
   * degrades to the node's start, which is where it already was.
   */
  private locateFragment(
    node: Parser.SyntaxNode,
    fragment: string,
    cursor: { at: number; ordinal: number }
  ): { startLine: number; endLine: number; startColumn: number; endColumn: number } {
    const nodeText = node.text;
    const found = fragment ? nodeText.indexOf(fragment, cursor.at) : -1;
    cursor.ordinal++;

    if (found < 0) {
      // Ordinal offset keeps two unlocatable fragments in one declaration from
      // sharing a key. It is a discriminator, not a claim about position.
      const column = node.startPosition.column + cursor.ordinal;
      return {
        startLine: node.startPosition.row + 1,
        endLine: node.startPosition.row + 1,
        startColumn: column,
        endColumn: column + fragment.length,
      };
    }

    cursor.at = found + fragment.length;

    const before = nodeText.slice(0, found);
    const newlines = (before.match(/\n/g) || []).length;
    const lastNl = before.lastIndexOf('\n');
    const column = newlines === 0
      ? node.startPosition.column + found
      : found - lastNl - 1;

    const inner = (fragment.match(/\n/g) || []).length;
    const line = node.startPosition.row + 1 + newlines;
    return {
      startLine: line,
      endLine: line + inner,
      startColumn: column,
      endColumn: column + (inner ? fragment.length - fragment.lastIndexOf('\n') - 1 : fragment.length),
    };
  }

  private scanStringForGStringRefs(
    text: string,
    node: Parser.SyntaxNode,
    ownerDeclarationHash: string,
    ownerBlockHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const cursor = { at: 0, ordinal: 0 };

    // Match ${-> ...} (lazy GString) first — must come before ${...}
    const lazyPattern = /\$\{->\s*([^}]+)\}/g;
    let match: RegExpExecArray | null;
    const processedRanges: [number, number][] = [];

    while ((match = lazyPattern.exec(text)) !== null) {
      processedRanges.push([match.index, match.index + match[0].length]);
      const lazyExpr = match[1] ?? '';
      const at = this.locateFragment(node, match[0], cursor);
      const ref = GradleValueReference.builder(
        lazyExpr.trim(),
        GradleValueReferenceType.LAZY_GSTRING,
        match[0],
        this.scriptHash,
        filePath, baseMservPath,
        at.startLine, at.endLine, at.startColumn, at.endColumn,
        serviceVersionHash
      )
        .withOwnerDeclarationHash(ownerDeclarationHash)
        .withOwnerBlockHash(ownerBlockHash)
        .build();
      this.extractedValueReferences.push(ref);
    }

    // Match ${expr} (full interpolation) — skip ranges already matched as lazy
    const fullPattern = /\$\{([^}]+)\}/g;
    while ((match = fullPattern.exec(text)) !== null) {
      if (processedRanges.some(([s, e]) => match!.index >= s && match!.index < e)) continue;
      const expr = (match[1] ?? '').trim();
      // Detect ext property access: ext.x, versions.x, rootProject.x
      const refType = expr.includes('.')
        ? GradleValueReferenceType.EXT_PROPERTY_ACCESS
        : GradleValueReferenceType.GSTRING_INTERPOLATION;

      const at = this.locateFragment(node, match[0], cursor);
      const ref = GradleValueReference.builder(
        expr,
        refType,
        match[0],
        this.scriptHash,
        filePath, baseMservPath,
        at.startLine, at.endLine, at.startColumn, at.endColumn,
        serviceVersionHash
      )
        .withOwnerDeclarationHash(ownerDeclarationHash)
        .withOwnerBlockHash(ownerBlockHash)
        .build();
      this.extractedValueReferences.push(ref);
    }

    // Match $varName (simple dollar-prefix) — skip if inside ${...}
    const simplePattern = /\$([a-zA-Z_][a-zA-Z0-9_.]*)/g;
    while ((match = simplePattern.exec(text)) !== null) {
      // Skip if this $ is part of a ${...} block
      if (match.index > 0 && text[match.index + 1] === '{') continue;
      // Check if inside an already-matched ${...} range
      const alreadyMatched = processedRanges.some(([s, e]) => match!.index >= s && match!.index < e);
      if (alreadyMatched) continue;
      // Also check against full pattern ranges
      const inFullInterp = text.substring(0, match.index).lastIndexOf('${') > text.substring(0, match.index).lastIndexOf('}');
      if (inFullInterp) continue;

      const simpleExpr = match[1] ?? '';
      const refType = simpleExpr.includes('.')
        ? GradleValueReferenceType.EXT_PROPERTY_ACCESS
        : GradleValueReferenceType.GSTRING_SIMPLE;

      const at = this.locateFragment(node, match[0], cursor);
      const ref = GradleValueReference.builder(
        simpleExpr,
        refType,
        match[0],
        this.scriptHash,
        filePath, baseMservPath,
        at.startLine, at.endLine, at.startColumn, at.endColumn,
        serviceVersionHash
      )
        .withOwnerDeclarationHash(ownerDeclarationHash)
        .withOwnerBlockHash(ownerBlockHash)
        .build();
      this.extractedValueReferences.push(ref);
    }
  }

  /** Known method-based value reference patterns: receiver.method → type */
  private static readonly METHOD_REF_PATTERNS: { pattern: RegExp; type: GradleValueReferenceType }[] = [
    { pattern: /System\.getProperty\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.SYSTEM_PROPERTY },
    { pattern: /System\.getenv\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.ENV_VARIABLE },
    { pattern: /System\.env\.([a-zA-Z_][a-zA-Z0-9_]*)/, type: GradleValueReferenceType.ENV_VARIABLE_SHORT },
    { pattern: /(?:project\.)?findProperty\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.FIND_PROPERTY },
    { pattern: /project\.property\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.PROJECT_PROPERTY },
    { pattern: /project\.hasProperty\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.HAS_PROPERTY },
    { pattern: /providers\.gradleProperty\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.GRADLE_PROPERTY_PROVIDER },
    { pattern: /providers\.systemProperty\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.SYSTEM_PROPERTY_PROVIDER },
    { pattern: /providers\.environmentVariable\s*\(\s*['"]([^'"]+)['"]\s*\)/, type: GradleValueReferenceType.ENV_VARIABLE_PROVIDER },
    { pattern: /file\s*\(\s*['"]([^'"]+)['"]\s*\)\.text/, type: GradleValueReferenceType.FILE_READ },
  ];

  /**
   * Scans an AST node's text for method-based value references
   * (System.getenv, findProperty, providers.*, file().text, etc.).
   */
  private scanNodeForMethodBasedRefs(
    node: Parser.SyntaxNode,
    ownerDeclarationHash: string,
    ownerBlockHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const text = node.text;
    const cursor = { at: 0, ordinal: 0 };

    for (const { pattern, type } of GradleFileExtractor.METHOD_REF_PATTERNS) {
      // Global, so a block reading three environment variables yields three
      // rows. The non-global exec only ever found the first, and the other two
      // were simply absent from the relation.
      const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
      let match: RegExpExecArray | null;
      while ((match = global.exec(text)) !== null) {
        if (match[0].length === 0) { global.lastIndex++; continue; }
        const extractedName = match[1] || match[0];
        const defaultValueMatch = text.match(/\?:\s*['"]([^'"]*)['"]/);
        const at = this.locateFragment(node, match[0], cursor);

        const ref = GradleValueReference.builder(
          extractedName,
          type,
          match[0],
          this.scriptHash,
          filePath, baseMservPath,
          at.startLine, at.endLine, at.startColumn, at.endColumn,
          serviceVersionHash
        )
          .withOwnerDeclarationHash(ownerDeclarationHash)
          .withOwnerBlockHash(ownerBlockHash);

        if (defaultValueMatch && defaultValueMatch[1]) {
          ref.withDefaultValue(defaultValueMatch[1]);
        }

        this.extractedValueReferences.push(ref.build());
      }
    }
  }

  // ─── Dependency Notation Classification ────────────────────────

  /**
   * Classifies the notation of a dependency coordinate.
   */
  private classifyDependencyNotation(args: string): string {
    const trimmed = args.trim();

    if (trimmed.startsWith('project(')) return GradleDependencyNotation.PROJECT;
    if (trimmed.startsWith('platform(')) return GradleDependencyNotation.PLATFORM;
    if (trimmed.startsWith('enforcedPlatform(')) return GradleDependencyNotation.ENFORCED_PLATFORM;
    if (trimmed.startsWith('testFixtures(')) return GradleDependencyNotation.TEST_FIXTURES;
    if (trimmed.startsWith('files(')) return GradleDependencyNotation.FILES;
    if (trimmed.startsWith('fileTree(')) return GradleDependencyNotation.FILE_TREE;
    if (trimmed === 'gradleApi()') return GradleDependencyNotation.GRADLE_API;
    if (trimmed === 'gradleTestKit()') return GradleDependencyNotation.GRADLE_TEST_KIT;
    if (trimmed === 'localGroovy()') return GradleDependencyNotation.LOCAL_GROOVY;
    if (trimmed.includes('group:') || trimmed.includes('name:')) return GradleDependencyNotation.MAP_NOTATION;
    if (trimmed.startsWith('libs.')) return GradleDependencyNotation.VERSION_CATALOG_ACCESSOR;

    // String notation: 'group:artifact:version' or "group:artifact:version"
    const unquoted = this.extractStringLiteral(trimmed);
    const colonCount = (unquoted.match(/:/g) || []).length;
    if (colonCount >= 2) {
      if (unquoted.includes('@')) return GradleDependencyNotation.STRING_WITH_EXTENSION;
      // Check for classifier (4th segment)
      if (colonCount >= 3) return GradleDependencyNotation.STRING_WITH_CLASSIFIER;
      return GradleDependencyNotation.STRING_NOTATION;
    }

    return GradleDependencyNotation.STRING_NOTATION;
  }
}
