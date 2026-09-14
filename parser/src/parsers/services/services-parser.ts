import * as path from 'path';

import { ServiceDescriptor } from '@/analysis-types/services/ServiceDescriptor';
import { ServiceProvider } from '@/analysis-types/services/ServiceProvider';

/**
 * One segment of a Java binary name: a legal Java identifier.
 *
 * `$` is deliberately allowed INSIDE a segment rather than treated as a
 * separator, because it is a legal identifier character. That is what makes a
 * nested name ambiguous on its face and why splitting is done separately, under
 * the guard in {@link ServicesParser.resolveBinaryName}.
 */
const IDENTIFIER_SEGMENT = String.raw`[\p{L}_$][\p{L}\p{N}_$]*`;

/** A fully-qualified binary name: one or more identifier segments joined by dots. */
const BINARY_NAME = new RegExp(`^${IDENTIFIER_SEGMENT}(\\.${IDENTIFIER_SEGMENT})*$`, 'u');

/**
 * A `$`-delimited part that names a real nested type.
 *
 * No `$` (the split consumed them), must not start with a digit, must not be
 * empty. The two exclusions are what keep the normalisation from inventing
 * names: `Outer$1` is a compiler-generated anonymous class and `Outer.1` is not
 * a name at all, and `A$$B` is one legal identifier that splits into an empty
 * part. Both are left in binary form rather than rewritten.
 */
const NESTED_PART = /^[\p{L}_][\p{L}\p{N}_]*(\.[\p{L}_][\p{L}\p{N}_]*)*$/u;

/** The comment character, per the `ServiceLoader` provider-configuration format. */
const COMMENT_CHAR = '#';

/** A UTF-8 BOM. The format mandates UTF-8, and a BOM is legal in a UTF-8 stream. */
const BOM = '﻿';

/** A binary name resolved into the parts every consumer would otherwise re-derive. */
export interface ResolvedBinaryName {
  /** Nested separators normalised to dots — the form the rest of the schema uses. */
  qualifiedName: string;
  /** The innermost segment. */
  simpleName: string;
  /** Everything before the outermost type name. Empty for a name in the default package. */
  packageName: string;
  /** The dotted name of the enclosing type, or empty when the name is not nested. */
  enclosingTypeName: string;
  /** The name as written contained a `$`. */
  isNested: boolean;
  /** The name as written is a legal Java binary name. */
  isWellFormed: boolean;
}

/** One provider name found on one line, before it becomes an entity. */
interface ParsedProviderLine {
  binaryName: string;
  line: number;
  startCol: number;
  endCol: number;
  hasInlineComment: boolean;
}

/**
 * Parser for `META-INF/services` provider-configuration files.
 *
 * The format is specified by `java.util.ServiceLoader` and is deceptively small:
 *
 * - the file name is the binary name of the service being configured;
 * - each line names at most one concrete provider class;
 * - `#` starts a comment, and everything after the first `#` on a line is ignored;
 * - surrounding space and tab characters are ignored, and blank lines are ignored;
 * - the file is UTF-8;
 * - a class named twice is loaded once.
 *
 * Every one of those clauses is a row that a naive line reader gets wrong, and
 * the comment clause dominates in practice: on one corpus, 2,839 of the 3,736
 * lines across 272 provider-configuration files were comment lines, almost all
 * of them Apache licence headers. Reading lines verbatim would have produced
 * three garbage rows for every real one.
 */
export class ServicesParser {
  /**
   * Parses one provider-configuration file.
   *
   * @param content File content, UTF-8 decoded
   * @param filePath Absolute path to the file
   * @param baseMservPath Project root path
   * @param serviceVersionLinkHash Service version hash
   * @returns Tuple of [ServiceDescriptor, ServiceProvider[]]
   */
  parse(
    content: string,
    filePath: string,
    baseMservPath: string,
    serviceVersionLinkHash: string
  ): [ServiceDescriptor, ServiceProvider[]] {
    const fileName = path.basename(filePath);
    const service = this.resolveBinaryName(fileName);
    const lines = this.split(content);
    const parsedLines = this.parseProviderLines(lines);

    // Built before the providers because every provider row chains off its hash.
    const descriptor = ServiceDescriptor.builder(
      fileName,
      filePath,
      baseMservPath,
      serviceVersionLinkHash
    )
      .withServiceInterface(service.qualifiedName)
      .withSimpleName(service.simpleName)
      .withPackageName(service.packageName)
      .withIsNestedServiceName(service.isNested)
      .withIsWellFormedServiceName(service.isWellFormed)
      .withLineCount(lines.length)
      .withRelativePath(this.toPosix(path.relative(baseMservPath, filePath)) || fileName)
      .build();

    const seen = new Set<string>();
    const providers: ServiceProvider[] = [];

    parsedLines.forEach((parsed, position) => {
      const resolved = this.resolveBinaryName(parsed.binaryName);
      const isDuplicateInFile = seen.has(parsed.binaryName);
      seen.add(parsed.binaryName);

      providers.push(
        ServiceProvider.builder(
          parsed.binaryName,
          position,
          parsed.line,
          parsed.startCol,
          parsed.endCol,
          descriptor.getHash(),
          filePath,
          baseMservPath,
          serviceVersionLinkHash
        )
          .withProviderClass(resolved.qualifiedName)
          .withSimpleName(resolved.simpleName)
          .withPackageName(resolved.packageName)
          .withEnclosingTypeName(resolved.enclosingTypeName)
          .withIsNestedName(resolved.isNested)
          .withIsWellFormedName(resolved.isWellFormed)
          .withIsDuplicateInFile(isDuplicateInFile)
          .withHasInlineComment(parsed.hasInlineComment)
          .build()
      );
    });

    descriptor.setProviderCounts(
      providers.length,
      providers.filter((p) => p.getIsWellFormedName()).length
    );

    return [descriptor, providers];
  }

  /**
   * Splits file content into lines.
   *
   * The BOM is stripped from the first line only. Left in place it becomes part
   * of the first provider's name, which then fails the binary-name check — a
   * one-character invisible difference that turns a valid descriptor's first
   * provider into a malformed row.
   */
  private split(content: string): string[] {
    const withoutBom = content.startsWith(BOM) ? content.slice(BOM.length) : content;
    if (withoutBom.length === 0) {
      return [];
    }
    const lines = withoutBom.split(/\r\n|\r|\n/);
    // A trailing newline TERMINATES the last line, it does not start another.
    // Left in, every well-formed file reports one line more than it has, and
    // `lineCount` becomes a number that is wrong by one everywhere rather than
    // a measurement a consumer can compare against anything.
    if (lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }

  /**
   * Finds the provider name on each line, if any.
   *
   * Comment stripping happens BEFORE trimming, in that order, because the format
   * says the comment runs from the first `#` to end of line — so a line reading
   * `  org.acme.Codec  # the default` yields `org.acme.Codec`, and a line whose
   * only content is a comment yields nothing.
   */
  private parseProviderLines(lines: string[]): ParsedProviderLine[] {
    const parsed: ParsedProviderLine[] = [];

    lines.forEach((raw, index) => {
      const commentAt = raw.indexOf(COMMENT_CHAR);
      const hasInlineComment = commentAt !== -1;
      const code = hasInlineComment ? raw.slice(0, commentAt) : raw;

      const trimmed = code.trim();
      if (trimmed.length === 0) {
        return;
      }

      // The whole remaining text is the name, interior whitespace included. The
      // format allows at most one provider per line, so `a.B c.D` is ONE
      // malformed name and not two providers; splitting it would fabricate an
      // instantiation the JVM never performs — it throws instead.
      const startCol = code.indexOf(trimmed[0]!);
      parsed.push({
        binaryName: trimmed,
        line: index + 1,
        startCol,
        endCol: startCol + trimmed.length,
        // Only reported when the line ALSO carries a name; a pure comment line
        // produces no row at all, so there is nothing for the flag to describe.
        hasInlineComment,
      });
    });

    return parsed;
  }

  /**
   * Resolves a binary name into its dotted form and its parts.
   *
   * Nested separators are rewritten to dots only when every `$`-delimited part
   * is itself a plain identifier — see {@link NESTED_PART}. When the guard fails
   * the name is reported verbatim, so a synthetic name survives as
   * `org.acme.Outer$1` rather than being rewritten into something that names
   * nothing.
   */
  resolveBinaryName(binaryName: string): ResolvedBinaryName {
    const isWellFormed = BINARY_NAME.test(binaryName);
    const isNested = binaryName.includes('$');

    // A malformed token has no parts to report, and reporting them anyway is
    // the worse failure: splitting `!org.acme.Suppressed` on '.' yields the
    // package `!org.acme` and splitting `a.B c.D` yields the package
    // `a.B c` — names that exist nowhere, in the columns a consumer joins on.
    // The token itself is still carried, because a configuration error has to
    // be quotable back to the user.
    if (!isWellFormed) {
      return {
        qualifiedName: binaryName,
        simpleName: '',
        packageName: '',
        enclosingTypeName: '',
        isNested,
        isWellFormed: false,
      };
    }

    if (!isNested) {
      const lastDot = binaryName.lastIndexOf('.');
      return {
        qualifiedName: binaryName,
        simpleName: lastDot === -1 ? binaryName : binaryName.slice(lastDot + 1),
        packageName: lastDot === -1 ? '' : binaryName.slice(0, lastDot),
        enclosingTypeName: '',
        isNested: false,
        isWellFormed,
      };
    }

    const parts = binaryName.split('$');
    const outermost = parts[0]!;
    const outermostLastDot = outermost.lastIndexOf('.');
    const packageName = outermostLastDot === -1 ? '' : outermost.slice(0, outermostLastDot);
    const normalisable = parts.every((part) => NESTED_PART.test(part));

    if (!normalisable) {
      // The `$` structure is not trustworthy here, so only what survives
      // independently of it is reported: the package, and the binary simple
      // name — the last DOTTED segment, which is unambiguous because a package
      // segment never contains a `$` in practice. `enclosingTypeName` is
      // withheld rather than guessed: joining the leading parts back with `$`
      // turns `org.acme.A$$B` into the enclosing type `org.acme.A$`.
      const lastDot = binaryName.lastIndexOf('.');
      return {
        qualifiedName: binaryName,
        simpleName: lastDot === -1 ? binaryName : binaryName.slice(lastDot + 1),
        packageName,
        enclosingTypeName: '',
        isNested: true,
        isWellFormed,
      };
    }

    return {
      qualifiedName: parts.join('.'),
      simpleName: parts[parts.length - 1]!,
      packageName,
      enclosingTypeName: parts.slice(0, -1).join('.'),
      isNested: true,
      isWellFormed,
    };
  }

  private toPosix(p: string): string {
    return p.split(path.sep).join('/');
  }
}
