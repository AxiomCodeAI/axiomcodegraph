package com.axiomcode.test.expressions;

/**
 * Acceptance fixture for the components of a NESTED record pattern (JEP 440).
 *
 * A deconstruction's top-level components each got a local variable row with
 * scopeKind RECORD_PATTERN carrying their written type. A component that is
 * itself a record pattern did not: its own components produced no row, at any
 * depth.
 *
 * The nested pattern is a direct child of the record_pattern_body, not wrapped
 * in a record_pattern_component, so a loop that matched only components skipped
 * it. A recursive branch existed already, but on the children of record_pattern
 * rather than of its body, where a nested pattern never appears.
 *
 * The consequence was quiet rather than unsound: with no entity for the binding,
 * a call on it is honestly a declared unknown and can never be anything else.
 * Matching a shape more than one level deep is the point of the feature, and
 * `Line(Point(var x1, var y1), Point p2)` is the JEP's own example.
 *
 * The single-level cases are the controls: they were always recorded, and they
 * pin that the recursion adds rows without duplicating the ones already there.
 */
public class NestedRecordPatterns {

    /** Control: only top-level components, which always worked. */
    String topLevelOnly(Node n) {
        if (n instanceof Pair(Leaf a, Node ignored)) {
            return a.render();
        }
        return "";
    }

    /** One level of nesting: x and i2 come from the inner pattern. */
    String oneLevelDeep(Node n) {
        if (n instanceof Pair(Pair(Leaf x, Node i2), Node i3)) {
            return x.render() + i2 + i3;
        }
        return "";
    }

    /** The JEP's canonical example, with `var` components. */
    void jepCanonical(Object o) {
        if (o instanceof Line(Point(var x1, var y1), Point p2)) {
            System.out.println(x1 + y1 + p2.x());
        }
    }

    /** Three levels, so the recursion cannot stop after one. */
    void threeLevelsDeep(Object o) {
        if (o instanceof Box(Line(Point(int a1, int b1), Point c1), Point d1)) {
            System.out.println(a1 + b1 + c1.x() + d1.y());
        }
    }

    /** A nested deconstruction in a switch pattern rather than an instanceof. */
    String inSwitch(Object o) {
        return switch (o) {
            case Line(Point(var p, var q), Point r) -> "" + p + q + r.x();
            default -> "";
        };
    }
}

sealed interface Node permits Leaf, Pair { }
record Leaf(String value) implements Node { String render() { return "L"; } }
record Pair(Node left, Node right) implements Node { String render() { return "P"; } }
record Point(int x, int y) { }
record Line(Point from, Point to) { }
record Box(Line diag, Point origin) { }
