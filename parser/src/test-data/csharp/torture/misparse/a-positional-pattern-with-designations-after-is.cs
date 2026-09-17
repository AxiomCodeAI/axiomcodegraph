// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a positional pattern with designations after is
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// is_pattern_expression > recursive_pattern. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { bool M(object o) => o is Point(var x, var y) && x > 0; }
