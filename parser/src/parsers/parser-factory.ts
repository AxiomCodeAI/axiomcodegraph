import { CSharpParser } from '@/parsers/csharp/csharp-parser';
import { JavaParser } from '@/parsers/java/java-parser';
import { LanguageParser } from '@/parsers/language-parser';
import { PythonParser } from '@/parsers/python/python-parser';
import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Factory for creating language-specific parsers
 * Manages parser instances and delegates to the appropriate parser
 */
export class ParserFactory {
  private parsers: Map<ProjectLanguage, LanguageParser>;

  constructor() {
    this.parsers = new Map();
    this.registerDefaultParsers();
  }

  /**
   * Registers default parsers for supported languages
   */
  private registerDefaultParsers(): void {
    this.registerParser(new JavaParser());
    this.registerParser(new PythonParser());
    // Registered once cs-corpus's sweeps converged (7 and 8, zero new
    // disagreements over a constant base) — the order was: sweeps clean,
    // then registration, so every sweep from here exercises it rather than
    // it being bolted on last. Constructing the parser runs the grammar
    // gate, so a wrong grammar fails HERE, at factory construction.
    this.registerParser(new CSharpParser());
  }

  /**
   * Registers a language parser
   * @param parser Language parser to register
   */
  registerParser(parser: LanguageParser): void {
    this.parsers.set(parser.language, parser);
  }

  /**
   * Gets a parser for the specified language
   * @param language Programming language
   * @returns Language parser or undefined if not supported
   */
  getParser(language: ProjectLanguage): LanguageParser | undefined {
    return this.parsers.get(language);
  }

  /**
   * Gets a parser by file extension
   * @param fileExtension File extension (e.g., '.java')
   * @returns Language parser or undefined if not supported
   */
  getParserByExtension(fileExtension: string): LanguageParser | undefined {
    for (const parser of this.parsers.values()) {
      if (parser.fileExtension === fileExtension) {
        return parser;
      }
    }
    return undefined;
  }

  /**
   * Checks if a language is supported
   * @param language Programming language
   * @returns True if language is supported
   */
  isLanguageSupported(language: ProjectLanguage): boolean {
    return this.parsers.has(language);
  }

  /**
   * Gets all supported languages
   * @returns Array of supported languages
   */
  getSupportedLanguages(): ProjectLanguage[] {
    return Array.from(this.parsers.keys());
  }
}
