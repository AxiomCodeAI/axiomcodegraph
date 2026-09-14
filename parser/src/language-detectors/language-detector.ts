import { ProjectLanguage } from '@/types/ProjectInfo';

export interface LanguageDetector {
  /**
   * The language this detector is responsible for
   */
  readonly language: ProjectLanguage;

  /**
   * Checks if the given directory is a project of this language
   * @param projectPath Path to the directory to check
   * @returns True if this is a project of this language
   */
  isProject(projectPath: string): Promise<boolean>;

  /**
   * Detects the build system or framework for this language
   * @param projectPath Path to the project directory
   * @returns Build system/framework name, or undefined if not detected
   */
  detectBuildSystem(projectPath: string): Promise<string | undefined>;

  /**
   * Checks if directory has source files of this language
   * @param projectPath Path to check
   * @returns True if source files are found
   */
  hasSourceFiles(projectPath: string): Promise<boolean>;
}
