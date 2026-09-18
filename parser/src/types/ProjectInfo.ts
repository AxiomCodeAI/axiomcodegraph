export enum ProjectLanguage {
  JAVA = 'JAVA',
  PYTHON = 'PYTHON',
  TYPESCRIPT = 'TYPESCRIPT',
  JAVASCRIPT = 'JAVASCRIPT',
  GO = 'GO',
  RUST = 'RUST',
  C = 'C',
  CSHARP = 'CSHARP',
  GROOVY = 'GROOVY',
  UNKNOWN = 'UNKNOWN',
}

export interface ProjectInfo {
  name: string;
  path: string;
  language: ProjectLanguage;
  buildSystem?: string;
  hasSourceFiles: boolean;
}
