/**
 * Whether a unary operator precedes or follows its operand —
 * `cs_expression.unaryFixity`.
 *
 * `i++` and `++i` are the SAME operator with different result values, and an
 * engine modelling dataflow through an increment needs to know which. One kind
 * plus this column, rather than two kinds — §3's variant-in-a-field.
 */
export enum CsUnaryFixity {
  NONE = 'NONE',
  PREFIX = 'PREFIX',
  POSTFIX = 'POSTFIX',
}
