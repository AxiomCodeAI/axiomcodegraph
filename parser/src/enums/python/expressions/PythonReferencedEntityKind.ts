/**
 * What a name reference resolves to, as far as the parser can honestly tell.
 *
 * `UNKNOWN` is a first-class answer, not a failure. The parser resolves within
 * one module and stops where CPython stops being able to answer; claiming more
 * would produce facts the oracle cannot check.
 *
 * Schema v6 §2.15 c14.
 */
export enum PythonReferencedEntityKind {
  TYPE = 'TYPE',
  METHOD = 'METHOD',
  FIELD = 'FIELD',
  ATTRIBUTE = 'ATTRIBUTE',
  MODULE = 'MODULE',
  IMPORT = 'IMPORT',
  PARAMETER = 'PARAMETER',
  LOCAL_VARIABLE = 'LOCAL_VARIABLE',
  GLOBAL_VARIABLE = 'GLOBAL_VARIABLE',
  NONLOCAL_VARIABLE = 'NONLOCAL_VARIABLE',
  FREE_VARIABLE = 'FREE_VARIABLE',
  BUILTIN = 'BUILTIN',
  /** The receiver parameter of an instance method. */
  SELF = 'SELF',
  /** The receiver parameter of a classmethod. */
  CLS = 'CLS',
  /** `super` — an MRO-ordered lookup, not virtual dispatch. */
  SUPER = 'SUPER',
  COMPREHENSION_VARIABLE = 'COMPREHENSION_VARIABLE',
  EXCEPT_VARIABLE = 'EXCEPT_VARIABLE',
  WALRUS_TARGET = 'WALRUS_TARGET',
  /** Not resolvable within this module. The honest default. */
  UNKNOWN = 'UNKNOWN',
}
