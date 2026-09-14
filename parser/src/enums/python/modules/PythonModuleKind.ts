/**
 * Classifies a Python module by the role its file plays in a package.
 *
 * Python's module is a first-class runtime namespace object and the unit of
 * import resolution, so the kind is not cosmetic: `PACKAGE_INIT` participates
 * in re-export resolution, and `STUB` bodies are declarations that must never
 * be treated as call targets.
 *
 * ## Examples
 *
 * ```
 * app/web/views.py      -> MODULE
 * app/web/__init__.py   -> PACKAGE_INIT
 * app/web/  (no init)   -> NAMESPACE_PACKAGE   (PEP 420)
 * scripts/migrate.py    -> SCRIPT              (no package, executable)
 * stubs/views.pyi       -> STUB
 * tools/run.py          -> MAIN_GUARD_SCRIPT   (has `if __name__ == "__main__"`)
 * ```
 *
 * Schema v6 §2.1 c5.
 */
export enum PythonModuleKind {
  /** An ordinary importable `.py` module inside a package. */
  MODULE = 'MODULE',

  /** An `__init__.py` — the package's own namespace, and its re-export surface. */
  PACKAGE_INIT = 'PACKAGE_INIT',

  /** A PEP 420 implicit namespace package directory with no `__init__.py`. */
  NAMESPACE_PACKAGE = 'NAMESPACE_PACKAGE',

  /** A top-level file outside any package — imported by nothing. */
  SCRIPT = 'SCRIPT',

  /** A `.pyi` type stub: signatures only, bodies are `...`. */
  STUB = 'STUB',

  /** A script carrying an `if __name__ == "__main__":` entry point. */
  MAIN_GUARD_SCRIPT = 'MAIN_GUARD_SCRIPT',
}
