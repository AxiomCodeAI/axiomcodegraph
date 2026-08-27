/** `ts_method_parameter` enums — schema §4.7. */

/** `ts_method_parameter` c12 — in the primary key. */
export enum TsParamKind {
  REQUIRED = 'REQUIRED',
  OPTIONAL = 'OPTIONAL',
  REST = 'REST',
  /** An explicit `this: T`, which occupies position 0 and is not a runtime argument. */
  THIS = 'THIS',
  BINDING_OBJECT = 'BINDING_OBJECT',
  BINDING_ARRAY = 'BINDING_ARRAY',
  /** `constructor(private x: T)` — this parameter also DECLARES A FIELD. */
  PARAMETER_PROPERTY = 'PARAMETER_PROPERTY',
}

/** `ts_method_parameter` c16. */
export enum TsDefaultValueKind {
  NONE = 'NONE',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOL = 'BOOL',
  NULL = 'NULL',
  UNDEFINED = 'UNDEFINED',
  OBJECT = 'OBJECT',
  ARRAY = 'ARRAY',
  CALL = 'CALL',
  NEW = 'NEW',
  IDENTIFIER = 'IDENTIFIER',
  ARROW = 'ARROW',
  TEMPLATE = 'TEMPLATE',
  UNKNOWN = 'UNKNOWN',
}

/** `ts_method_parameter` c18 — comma-set, only on a parameter property. */
export enum TsParameterPropertyModifier {
  PRIVATE = 'PRIVATE',
  PROTECTED = 'PROTECTED',
  PUBLIC = 'PUBLIC',
  READONLY = 'READONLY',
}
