// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a slice pattern with a sub-pattern
// KIND : ERROR
//
// Through the SHIPPED pipeline — inactive #if arms blanked, then parsed — this
// still produces an ERROR node. The parser must emit a cs_parse_gap row: a
// recorded absence, never a silent one.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

class C { string M(int[] v) => v switch { [var head, .. var tail] => "h", _ => "x" }; }
