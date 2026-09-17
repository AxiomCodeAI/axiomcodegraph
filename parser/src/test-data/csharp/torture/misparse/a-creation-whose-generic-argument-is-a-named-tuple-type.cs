// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a creation whose generic argument is a named tuple type
// KIND : MISPARSE
//
// Parses without error and yields the WRONG tree. A correct parse would give
// object_creation_expression > argument_list. Nothing flags this, which is why it is the repairable set.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { object M(object src) => new HashSet<(string Name, string? Schema)>(src); }
