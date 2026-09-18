// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a relational pattern as the condition of a conditional expression
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// conditional_expression > is_pattern_expression. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { int M(int m) => m is < -1 ? T(m) : S(m); }
