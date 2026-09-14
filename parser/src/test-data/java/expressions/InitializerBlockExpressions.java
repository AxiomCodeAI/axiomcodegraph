package com.axiomcode.test.expressions;

import java.util.List;

/**
 * Acceptance fixture for expressions inside a static or instance initializer.
 *
 * Only expression statements were extracted from an initializer body, so every
 * expression in a control-flow POSITION was dropped: an if or while condition,
 * an enhanced-for iterable, a throw value. The bodies of those statements
 * survived, because their contents are expression statements in their own right,
 * which is why an initializer reached the fact set looking like a straight-line
 * block rather than an empty one. A call site that produces no row is neither an
 * edge nor a declared unknown.
 *
 * The three members below hold the SAME seven statements. The method is the
 * oracle: whatever it produces, both initializers must produce too, because an
 * initializer body is an ordinary block. Asserting the equivalence rather than a
 * fixed list means the fixture keeps discriminating if the extractor's context
 * vocabulary changes later.
 */
public class InitializerBlockExpressions {

    static boolean cond() { return true; }
    static List<String> items() { return null; }
    static String pick() { return "x"; }
    static void act() { }

    static {
        act();
        if (cond()) { act(); }
        for (String s : items()) { act(); }
        while (cond()) { act(); }
        String v = pick();
        try { act(); } catch (Exception e) { throw new RuntimeException(pick()); }
    }

    {
        act();
        if (cond()) { act(); }
        for (String s : items()) { act(); }
        while (cond()) { act(); }
        String v = pick();
        try { act(); } catch (Exception e) { throw new RuntimeException(pick()); }
    }

    void method() {
        act();
        if (cond()) { act(); }
        for (String s : items()) { act(); }
        while (cond()) { act(); }
        String v = pick();
        try { act(); } catch (Exception e) { throw new RuntimeException(pick()); }
    }
}
