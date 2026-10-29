// the bundler's typing of import.meta.glob (a project declaration, as a vite-env file would add it)
declare global {
  interface ImportMeta {
    glob<M = Record<string, unknown>>(pattern: string | string[], options?: { eager?: boolean }): Record<string, M>
  }
}
export {}
