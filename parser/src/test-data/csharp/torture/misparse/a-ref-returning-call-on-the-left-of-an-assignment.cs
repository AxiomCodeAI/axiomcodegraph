// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a ref-returning call on the left of an assignment
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// assignment_expression. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { void M() { Local(instance) = value; A.ById(o) = Plain(); } }
