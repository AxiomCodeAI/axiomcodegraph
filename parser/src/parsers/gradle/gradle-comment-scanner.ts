import { GradleCommentKind } from '@/enums/gradle/comments/GradleCommentKind';

export interface ScannedComment {
  kind: GradleCommentKind;
  /** Comment body with the delimiters removed, whitespace-normalised. */
  text: string;
  isCommentedOutCode: boolean;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
}

/**
 * Finds comments in Gradle source.
 *
 * ## Why this scans the text instead of reading the tree
 *
 * It runs over the ORIGINAL source, before the extractor's preprocessing
 * rewrites anything. That is deliberate twice over. The rewrites delete tokens
 * and can turn a construct into an ERROR node, and everything a tree-sitter
 * ERROR node swallows — including any comment inside it — is unreachable from
 * the tree. On a Kotlin DSL file, where the rewrites are heaviest, that is
 * most of the file. A scanner over the raw bytes is the only way to get
 * comments off those files at all, and the positions it reports are the real
 * ones rather than post-rewrite ones.
 *
 * ## Known limit
 *
 * Groovy's slashy strings (`/foo\/bar/`) are not tracked, so a `//` inside one
 * reads as the start of a line comment. They are almost unheard of in build
 * scripts and tracking them requires distinguishing a division operator from a
 * string opener, which needs the very parse this scanner exists to work
 * around. The failure mode is a spurious comment row, not a lost declaration.
 */
export class GradleCommentScanner {
  /**
   * Patterns whose presence in a comment body means the comment is very likely
   * disabled code rather than prose. Deliberately narrow: this flag is a hint
   * for a consumer, and a false positive is worse than a miss because the
   * whole point is to distinguish "the build says nothing about log4j" from
   * "the build used to depend on log4j and someone commented it out".
   */
  private static readonly CODE_PATTERNS: RegExp[] = [
    /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly|annotationProcessor|classpath|compile|runtime|kapt|ksp|developmentOnly|providedCompile)\s*[('"]/,
    /^\s*apply\s+(plugin|from)\s*:/,
    /^\s*id\s*[('"]/,
    /^\s*(include|includeBuild)\s*[('"]/,
    /^\s*(maven|mavenCentral|mavenLocal|jcenter|google|gradlePluginPortal)\s*[({]/,
    /^\s*\w+\s*=\s*['"]/,
  ];

  static scan(source: string): ScannedComment[] {
    const out: ScannedComment[] = [];
    const lines = source.split('\n');

    let inBlock = false;
    let blockIsDoc = false;
    let blockStartLine = 0;
    let blockStartCol = 0;
    let blockBody: string[] = [];

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li] ?? '';

      if (inBlock) {
        const end = line.indexOf('*/');
        if (end < 0) {
          blockBody.push(line);
          continue;
        }
        blockBody.push(line.slice(0, end));
        out.push(this.makeBlock(
          blockIsDoc, blockBody, blockStartLine, blockStartCol, li + 1, end + 2
        ));
        inBlock = false;
        blockBody = [];
        // Keep scanning after the terminator: `*/ implementation 'x' // note`
        // puts a real comment on the same line.
        const rest = this.scanLine(line.slice(end + 2), li + 1, end + 2);
        for (const c of rest.comments) out.push(c);
        if (rest.openBlock) {
          inBlock = true;
          blockIsDoc = rest.openBlock.isDoc;
          blockStartLine = rest.openBlock.startLine;
          blockStartCol = rest.openBlock.startColumn;
          blockBody = [rest.openBlock.firstLineBody];
        }
        continue;
      }

      if (li === 0 && line.startsWith('#!')) {
        out.push({
          kind: GradleCommentKind.SHEBANG,
          text: line.slice(2).trim(),
          isCommentedOutCode: false,
          startLine: 1, endLine: 1, startColumn: 0, endColumn: line.length,
        });
        continue;
      }

      const res = this.scanLine(line, li + 1, 0);
      for (const c of res.comments) out.push(c);
      if (res.openBlock) {
        inBlock = true;
        blockIsDoc = res.openBlock.isDoc;
        blockStartLine = res.openBlock.startLine;
        blockStartCol = res.openBlock.startColumn;
        blockBody = [res.openBlock.firstLineBody];
      }
    }

    // An unterminated block comment runs to end of file. Gradle would reject
    // the script, but the row is still emitted so the region is visible.
    if (inBlock) {
      out.push(this.makeBlock(
        blockIsDoc, blockBody, blockStartLine, blockStartCol,
        lines.length, (lines[lines.length - 1] ?? '').length
      ));
    }

    return out;
  }

  /**
   * Scans one line's worth of text, tracking quote state so a `//` inside a
   * string is not mistaken for a comment. `url 'https://repo.example.com'` is
   * the case that matters — it appears in nearly every repositories block, and
   * a scanner that misses it reports the second half of every repository URL
   * as a comment.
   */
  private static scanLine(
    text: string,
    lineNumber: number,
    columnOffset: number
  ): {
    comments: ScannedComment[];
    openBlock?: { isDoc: boolean; startLine: number; startColumn: number; firstLineBody: string };
  } {
    const comments: ScannedComment[] = [];
    let inSingle = false;
    let inDouble = false;
    let tripleSingle = false;
    let tripleDouble = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '\\') { i++; continue; }

      if (!inDouble && !tripleDouble && text.startsWith("'''", i)) { tripleSingle = !tripleSingle; i += 2; continue; }
      if (!inSingle && !tripleSingle && text.startsWith('"""', i)) { tripleDouble = !tripleDouble; i += 2; continue; }
      if (tripleSingle || tripleDouble) continue;

      if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
      if (inSingle || inDouble) continue;

      if (ch === '/' && next === '/') {
        const body = text.slice(i + 2);
        comments.push({
          kind: GradleCommentKind.LINE,
          text: body.trim(),
          isCommentedOutCode: this.looksLikeCode(body),
          startLine: lineNumber,
          endLine: lineNumber,
          startColumn: columnOffset + i,
          endColumn: columnOffset + text.length,
        });
        return { comments };
      }

      if (ch === '/' && next === '*') {
        const isDoc = text[i + 2] === '*';
        const bodyStart = i + (isDoc ? 3 : 2);
        const close = text.indexOf('*/', bodyStart);
        if (close >= 0) {
          const body = text.slice(bodyStart, close);
          comments.push({
            kind: isDoc ? GradleCommentKind.GROOVYDOC : GradleCommentKind.BLOCK,
            text: this.normalise(body),
            isCommentedOutCode: this.looksLikeCode(body),
            startLine: lineNumber,
            endLine: lineNumber,
            startColumn: columnOffset + i,
            endColumn: columnOffset + close + 2,
          });
          i = close + 1;
          continue;
        }
        return {
          comments,
          openBlock: {
            isDoc,
            startLine: lineNumber,
            startColumn: columnOffset + i,
            firstLineBody: text.slice(bodyStart),
          },
        };
      }
    }

    return { comments };
  }

  private static makeBlock(
    isDoc: boolean,
    body: string[],
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
  ): ScannedComment {
    // GroovyDoc continuation asterisks are formatting, not content.
    const cleaned = body
      .map((l) => l.replace(/^\s*\*\s?/, ''))
      .join(' ');
    return {
      kind: isDoc ? GradleCommentKind.GROOVYDOC : GradleCommentKind.BLOCK,
      text: this.normalise(cleaned),
      isCommentedOutCode: body.some((l) => this.looksLikeCode(l)),
      startLine, endLine, startColumn, endColumn,
    };
  }

  private static looksLikeCode(body: string): boolean {
    return this.CODE_PATTERNS.some((p) => p.test(body));
  }

  private static normalise(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
}
