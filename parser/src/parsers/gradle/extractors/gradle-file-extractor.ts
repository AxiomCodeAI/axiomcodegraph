import Parser from 'tree-sitter';

import { GradleBlock } from '@/analysis-types/gradle/GradleBlock';
import { GradleDeclaration } from '@/analysis-types/gradle/GradleDeclaration';
import { GradleValueReference } from '@/analysis-types/gradle/GradleValueReference';
import { GradleBlockType } from '@/enums/gradle/blocks/GradleBlockType';
import { GradleDeclarationType } from '@/enums/gradle/declarations/GradleDeclarationType';
import { GradleDependencyNotation } from '@/enums/gradle/declarations/GradleDependencyNotation';
import { GradlePluginSyntax } from '@/enums/gradle/declarations/GradlePluginSyntax';
import { GradleRepositoryType } from '@/enums/gradle/declarations/GradleRepositoryType';
import { GradleDSLDialect } from '@/enums/gradle/files/GradleDSLDialect';
import { GradleValueReferenceType } from '@/enums/gradle/value-references/GradleValueReferenceType';
import { BaseExtractor } from '@/parsers/base-extractor';
import { GroovyParser } from '@/parsers/gradle/groovy-parser';

/**
 * Extracts Gradle entities from .gradle build files using tree-sitter-groovy.
 *
 * Single-pass AST walk that extracts:
 * - GradleBlock: every { } block (DSL blocks, control flow)
 * - GradleDeclaration: dependencies, plugins, repositories, properties, etc.
 * - GradleValueReference: ${var}, $var, findProperty(), System.getenv(), etc.
 *
 * Follows the same extractor pattern as Java's TypeRegistryExtractor:
 * - Implements BaseExtractor<GradleBlock> for the primary entity
 * - Stores secondary entities internally, exposed via getters
 * - Creates its own parser instance
 */
export class GradleFileExtractor implements BaseExtractor<GradleBlock> {
  private groovyParser: GroovyParser;
  private extractedDeclarations: GradleDeclaration[] = [];
  private extractedValueReferences: GradleValueReference[] = [];
  private originalLines: string[] = [];
  /** Args stripped by step 6 for method("arg") { closure } patterns, keyed by 1-indexed line number. */
  private strippedClosureArgs: Map<number, { methodName: string; args: string }> = new Map();

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

  /**
   * Extracts GradleBlock entities (and populates declarations/value references)
   * from a single Gradle file.
   *
   * @param filePath Absolute path to the .gradle file
   * @param fileContent Contents of the file
   * @param serviceVersionHash Service version identifier hash
   * @returns Array of GradleBlock entities
   */
  extract(filePath: string, fileContent: string, serviceVersionHash: string): GradleBlock[] {
    // Clear previous file's results
    this.extractedDeclarations = [];
    this.extractedValueReferences = [];
    this.strippedClosureArgs = new Map();
    this.originalLines = fileContent.split('\n');

    const dialect = this.detectDialect(filePath);
    const baseMservPath = this.extractBaseMservPath(filePath);

    // Pre-process: strip syntax that confuses tree-sitter-groovy
    //   0. GString interp:   "${foo("x")}"             →  "__INTERP__"
    //   1. Type annotations:  val name: String = value  →  val name = value
    //   2. Delegated props:   val name by extra("v")   →  val name = extra("v")
    //   3. Class references:  HttpHeaders::class        →  HttpHeaders
    //   4. Inline generics:   create<Type>("x")         →  create("x")
    //   5. Type casts:        x as String?              →  x
    //   6. Trailing closures: creds(Cls) {              →  creds {
    //   7. Elvis operator:    x ?: y                    →  x || y
    //   8. Empty strings:     ''                         →  '_EMPTY_'
    //   9. Non-ASCII chars:   ─, —, etc.                  →  _
    //  10. Named param quotes: key: 'val'                 →  key: "val"
    //  11. Dep wrapper calls:  impl files('a','b')          →  impl(files('a','b'))
    //  12. Closure params:     { project ->                  →  {
    const step0 = this.normalizeGStringInterpolation(fileContent);
    const step1 = this.stripKotlinTypeAnnotations(step0);
    const step2 = this.stripKotlinByDelegation(step1);
    const step3 = this.stripKotlinClassReferences(step2);
    const step4 = this.stripKotlinInlineGenerics(step3);
    const step5 = this.stripKotlinTypeCasts(step4);
    const step6 = this.stripTrailingClosureArgs(step5);
    const step7 = this.normalizeElvisOperator(step6);
    const step8 = this.normalizeEmptyStringLiterals(step7);
    const step9 = this.stripNonAsciiCharacters(step8);
    const step10 = this.convertNamedParamQuotes(step9);
    const step11 = this.normalizeDependencyWrapperCalls(step10);
    const preprocessed = this.stripClosureParameters(step11);

    let tree: Parser.Tree;
    try {
      tree = this.groovyParser.parse(preprocessed);
    } catch (error) {
      console.error(`[GradleFileExtractor] Failed to parse ${filePath}:`, error);
      return [];
    }

    const rootNode = this.groovyParser.getRootNode(tree);
    const blocks: GradleBlock[] = [];

    // Walk the AST from root, extracting blocks and declarations
    this.walkNode(
      rootNode,
      blocks,
      filePath,
      baseMservPath,
      dialect,
      serviceVersionHash,
      '', // parentBlockHash (root has none)
      0   // depth
    );

    // Restoration pass: replace preprocessing placeholders with original text
    this.restorePreprocessedValues();

    // Post-restoration pass: extract GString value references from restored values
    // (step 0 replaced ${...} with __INTERP__ so scanStringForGStringRefs missed them)
    this.extractRestoredGStringRefs(filePath, baseMservPath, serviceVersionHash);

    // Resolution pass: link value references to source PROPERTY declarations
    this.resolveValueReferences();

    return blocks;
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
        decl.getParentBlockHash(), decl.getFilePath(), decl.getBaseMservPath(),
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

      restored.push(rebuilt);
    }
    this.extractedDeclarations = restored;
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
        filePath,
        baseMservPath,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        serviceVersionHash
      )
        .withBlockName(methodName)
        .withParentBlockHash(parentBlockHash)
        .build();

      blocks.push(block);

      // Recover stripped args for method("arg") { closure } patterns
      this.recoverStrippedClosureArgs(
        node, block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
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
        filePath,
        baseMservPath,
        node.startPosition.row + 1,
        node.endPosition.row + 1,
        serviceVersionHash
      )
        .withBlockName(methodName)
        .withParentBlockHash(parentBlockHash)
        .build();

      blocks.push(block);

      // Recover stripped args for method("arg") { closure } patterns
      this.recoverStrippedClosureArgs(
        node, block, methodName, dialect, filePath, baseMservPath, serviceVersionHash
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
    const endLine = node.endPosition.row + 1;
    const startCol = node.startPosition.column;
    const endCol = node.endPosition.column;

    if (GradleFileExtractor.DEPENDENCY_CONFIGS.has(blockMethodName)) {
      const notation = this.classifyDependencyNotation(args);
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.DEPENDENCY, args, dialect, block.getHash(),
        filePath, baseMservPath, startLine, endLine, startCol, endCol,
        serviceVersionHash
      )
        .withValue(args)
        .withQualifier(blockMethodName)
        .withNotation(notation)
        .build();
      this.extractedDeclarations.push(decl);
    } else {
      // Non-dep-config: emit as STATEMENT linked to the block
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.STATEMENT, saved.methodName, dialect, block.getHash(),
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

  /**
   * Creates a declaration from a method call without closure.
   * Determines if it's a dependency, plugin, repository, or generic statement.
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
    if (methodName === 'include' || methodName === 'includeBuild') {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.INCLUDE, args, dialect, parentBlockHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withQualifier(methodName)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Fallback: generic STATEMENT
    const stmtDecl = GradleDeclaration.builder(
      GradleDeclarationType.STATEMENT, methodName, dialect, parentBlockHash,
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

    // apply plugin: 'java'
    if (methodName === 'apply') {
      this.processApplyStatement(
        node, args, dialect, filePath, baseMservPath,
        startLine, endLine, startColumn, endColumn,
        serviceVersionHash, parentBlockHash
      );
      return;
    }

    // Include: include ':core', ':auth'
    if (methodName === 'include' || methodName === 'includeBuild') {
      const decl = GradleDeclaration.builder(
        GradleDeclarationType.INCLUDE, args, dialect, parentBlockHash,
        filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
        serviceVersionHash
      )
        .withQualifier(methodName)
        .build();

      this.extractedDeclarations.push(decl);
      this.extractValueReferences(node, args, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
      return;
    }

    // Fallback: generic STATEMENT
    const decl2 = GradleDeclaration.builder(
      GradleDeclarationType.STATEMENT, methodName, dialect, parentBlockHash,
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(args)
      .build();

    this.extractedDeclarations.push(decl2);
    this.extractValueReferences(node, args, decl2.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
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
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(value)
      .build();

    this.extractedDeclarations.push(decl);
    this.extractValueReferences(rhs, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);

    // Decompose Groovy map literals: versions = [awsSdk: '2.21.29', ...] → individual properties
    this.decomposeMapLiteral(name, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, dialect, serviceVersionHash, startLine, endLine);
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
      filePath, baseMservPath, startLine, endLine, startColumn, endColumn,
      serviceVersionHash
    )
      .withValue(value)
      .build();

    this.extractedDeclarations.push(decl);
    if (valueNode) {
      this.extractValueReferences(valueNode, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, serviceVersionHash);
    }

    // Decompose Groovy map literals: def versions = [awsSdk: '2.21.29', ...] → individual properties
    this.decomposeMapLiteral(name, value, decl.getHash(), parentBlockHash, filePath, baseMservPath, dialect, serviceVersionHash, startLine, endLine);
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
    startLine: number,
    endLine: number
  ): void {
    const trimmed = value.trim();
    // Must look like a Groovy map literal: starts with [ and ends with ]
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return;
    // Exclude list literals like ['a', 'b'] (no colon-separated entries)
    if (!trimmed.includes(':')) return;

    const inner = trimmed.slice(1, -1); // strip [ ]
    // Match key: value entries — value can be quoted string or bare identifier/number
    const entryPattern = /(\w+)\s*:\s*('[^']*'|"[^"]*"|[^,\]\n]+)/g;
    let match: RegExpExecArray | null;

    while ((match = entryPattern.exec(inner)) !== null) {
      const key = match[1];
      const val = (match[2] ?? '').trim();
      // Remove trailing comma if present
      const cleanVal = val.endsWith(',') ? val.slice(0, -1).trim() : val;
      const qualifiedName = `${parentName}.${key}`;

      const decl = GradleDeclaration.builder(
        GradleDeclarationType.PROPERTY, qualifiedName, dialect, parentBlockHash,
        filePath, baseMservPath, startLine, endLine, 0, 0,
        serviceVersionHash
      )
        .withValue(cleanVal)
        .withQualifier(parentName)
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
   * Post-extraction pass: links each value reference to the PROPERTY
   * declaration whose name matches the referenceExpression.
   *
   * Populates `resolvedContext` with the source property's hash so
   * downstream queries can JOIN on it.
   *
   * Handles dotted references (e.g., `versions.awsSdk`) by also
   * matching the first segment (`versions`).
   */
  private resolveValueReferences(): void {
    // Build name→hash map from PROPERTY declarations
    const propertyMap = new Map<string, string>();
    for (const decl of this.extractedDeclarations) {
      if (decl.getDeclarationType() === GradleDeclarationType.PROPERTY) {
        propertyMap.set(decl.getName(), decl.getHash());
      }
    }

    for (const ref of this.extractedValueReferences) {
      const expr = ref.getReferenceExpression();

      // Direct match: springBootVersion → springBootVersion property
      if (propertyMap.has(expr)) {
        ref.setResolvedContext(propertyMap.get(expr)!);
        continue;
      }

      // Dotted match: versions.awsSdk → versions property (map/ext)
      const dotIndex = expr.indexOf('.');
      if (dotIndex > 0) {
        const firstSegment = expr.substring(0, dotIndex);
        if (propertyMap.has(firstSegment)) {
          ref.setResolvedContext(propertyMap.get(firstSegment)!);
        }
      }
    }
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
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      serviceVersionHash
    )
      .withExpression(expression)
      .withParentBlockHash(parentBlockHash)
      .build();

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
              filePath,
              baseMservPath,
              child.startPosition.row + 1,
              child.endPosition.row + 1,
              serviceVersionHash
            )
              .withParentBlockHash(parentBlockHash)
              .build();

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
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      serviceVersionHash
    )
      .withParentBlockHash(parentBlockHash)
      .build();

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
          filePath,
          baseMservPath,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          serviceVersionHash
        )
          .withParentBlockHash(parentBlockHash)
          .withTryStatementHash(tryHash)
          .withCaughtExceptionTypes(caughtType)
          .build();

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
          filePath,
          baseMservPath,
          child.startPosition.row + 1,
          child.endPosition.row + 1,
          serviceVersionHash
        )
          .withParentBlockHash(parentBlockHash)
          .withTryStatementHash(tryHash)
          .build();

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
      filePath,
      baseMservPath,
      node.startPosition.row + 1,
      node.endPosition.row + 1,
      serviceVersionHash
    )
      .withExpression(expression)
      .withParentBlockHash(parentBlockHash)
      .build();

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
            filePath,
            baseMservPath,
            child.startPosition.row + 1,
            child.endPosition.row + 1,
            serviceVersionHash
          )
            .withBlockName(caseLabel)
            .withParentBlockHash(switchBlock.getHash())
            .build();

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
    return source.replace(
      /\b(val|var)\s+(\w+)\s*:\s*[A-Z]\w*(?:<[^>]*>)?\??\s*(=|by)\s/g,
      '$1 $2 $3 '
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
    return source.replace(
      /\b(val|var)\s+(\w+)\s+by\s+/g,
      '$1 $2 = '
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
    return source.replace(/\$\{[^}]+\}/g, '__INTERP__');
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
    return source.replace(
      /\b(\w+)\([^)\n]*\)[^\S\n]*\{/g,
      (match, name: string, offset: number) => {
        if (GradleFileExtractor.CONTROL_FLOW_KEYWORDS.has(name)) return match;
        // Save stripped args so we can recover them when creating the block
        const lineNumber = source.substring(0, offset).split('\n').length;
        const openParen = match.indexOf('(');
        const closeParen = match.lastIndexOf(')');
        if (openParen >= 0 && closeParen > openParen) {
          this.strippedClosureArgs.set(lineNumber, {
            methodName: name,
            args: match.substring(openParen + 1, closeParen),
          });
        }
        return name + ' {';
      }
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
    return source.replace(
      /\{([ \t]*)(?:[A-Z]\w+\s+)?\w+(?:\s*,\s*(?:[A-Z]\w+\s+)?\w+)*\s*->/g,
      '{$1'
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
    return source.replace(/\?:/g, '||');
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
    return source.replace(/(?<!')''(?!')/g, "'_EMPTY_'");
  }

  /**
   * Replaces non-ASCII characters (e.g. em-dash —, box-drawing ─) with _.
   * tree-sitter-groovy cannot handle multi-byte UTF-8 characters and will
   * produce ERROR nodes that cascade through the rest of the file.
   */
  private stripNonAsciiCharacters(source: string): string {
    return source.replace(/[^\x00-\x7F]/g, '_');
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
    return source.replace(/(\w+\s*:\s*)'([^'\n]*)'/g, '$1"$2"');
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
      result += source.substring(lastIndex, configEnd);
      result += '(';
      result += source.substring(configEnd, closePos + 1).trimStart();
      result += ')';
      lastIndex = closePos + 1;
      pattern.lastIndex = closePos + 1;
    }

    result += source.substring(lastIndex);
    return result;
  }

  /**
   * Strips Kotlin ::class references that tree-sitter-groovy cannot parse.
   *
   * Transforms:
   *   HttpHeaderCredentials::class  →  HttpHeaderCredentials
   *   String::class.java            →  String
   */
  private stripKotlinClassReferences(source: string): string {
    return source.replace(/(::\w+)(\.\w+)?/g, '');
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
    return source.replace(/(\w+)<[^>]+>\s*\(/g, '$1(');
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
    return source.replace(/\s+as\s+\w+(?:<[^>]*>)?\??/g, '');
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
  private scanStringForGStringRefs(
    text: string,
    node: Parser.SyntaxNode,
    ownerDeclarationHash: string,
    ownerBlockHash: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionHash: string
  ): void {
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    // Match ${-> ...} (lazy GString) first — must come before ${...}
    const lazyPattern = /\$\{->\s*([^}]+)\}/g;
    let match: RegExpExecArray | null;
    const processedRanges: [number, number][] = [];

    while ((match = lazyPattern.exec(text)) !== null) {
      processedRanges.push([match.index, match.index + match[0].length]);
      const lazyExpr = match[1] ?? '';
      const ref = GradleValueReference.builder(
        lazyExpr.trim(),
        GradleValueReferenceType.LAZY_GSTRING,
        match[0],
        filePath, baseMservPath,
        startLine, endLine, startColumn, endColumn,
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

      const ref = GradleValueReference.builder(
        expr,
        refType,
        match[0],
        filePath, baseMservPath,
        startLine, endLine, startColumn, endColumn,
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

      const ref = GradleValueReference.builder(
        simpleExpr,
        refType,
        match[0],
        filePath, baseMservPath,
        startLine, endLine, startColumn, endColumn,
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
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const startColumn = node.startPosition.column;
    const endColumn = node.endPosition.column;

    for (const { pattern, type } of GradleFileExtractor.METHOD_REF_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const extractedName = match[1] || match[0];
        const defaultValueMatch = text.match(/\?:\s*['"]([^'"]*)['"]/);

        const ref = GradleValueReference.builder(
          extractedName,
          type,
          match[0],
          filePath, baseMservPath,
          startLine, endLine, startColumn, endColumn,
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
