/**
 * Modifiers a `requires` directive may carry (JLS 7.7.1). No other directive kind takes one.
 *
 * - **TRANSITIVE** — any module reading this one also reads the required module. Dropping it
 *   would understate the module graph: dependents inherit the dependency implicitly.
 * - **STATIC** — the dependency is mandatory at compile time and optional at run time.
 */
export enum ModuleDirectiveModifier {
  TRANSITIVE = 'TRANSITIVE',
  STATIC = 'STATIC',
}
