// TORTURE FIXTURE — generated from KNOWN_GRAMMAR_LIMITATIONS. Do not hand-edit.
//
// SHAPE: a struct header with modifiers after ref
// KIND : ERROR
//
// Through the SHIPPED pipeline — inactive #if arms blanked, then parsed — this
// still produces an ERROR node. The parser must emit a cs_parse_gap row: a
// recorded absence, never a silent one.
//
// A fixture that stops reproducing its shape reports OK about nothing, so the
// suite asserts the SHAPE and not merely the file.

public readonly ref partial struct S<T> { }
