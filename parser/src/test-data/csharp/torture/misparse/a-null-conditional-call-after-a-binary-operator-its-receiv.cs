// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a null-conditional call after a binary operator, its receiver a name
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// conditional_access_expression > identifier. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { bool M(bool a, string b) => a || b?.Contains("z") == true; }
