// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a cast-prefixed generic method call
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// cast_expression > invocation_expression. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { object M() => (T)Convert<T>(x); }
