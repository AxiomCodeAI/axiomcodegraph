/**
 * The syntactic form of one write to an attribute.
 *
 * `py_field` merges every write to a name into one row, so this relation keeps
 * per-write granularity — required for data flow, since taint entering
 * `self.conn` in one method and read in another accounts for a third of the
 * measured `self.*` population.
 *
 * Schema v6 §2.10 c1.
 */
export enum PythonFieldWriteKind {
  /** `self.x = value`. */
  ASSIGN = 'ASSIGN',
  /** `self.x += value` — reads and writes. */
  AUG_ASSIGN = 'AUG_ASSIGN',
  /** `self.x: T = value`, or a bare `self.x: T`. */
  ANN_ASSIGN = 'ANN_ASSIGN',
  /** `del self.x`. */
  DEL = 'DEL',
  /** `setattr(self, "x", value)`. */
  SETATTR = 'SETATTR',
  /** `for self.x in ...`. */
  FOR_TARGET = 'FOR_TARGET',
  /** `with ... as self.x`. */
  WITH_TARGET = 'WITH_TARGET',
  /** `(self.x := value)`. */
  WALRUS = 'WALRUS',
  /** `self.x, self.y = pair` — the value is one element, not the whole RHS. */
  TUPLE_UNPACK = 'TUPLE_UNPACK',
}
