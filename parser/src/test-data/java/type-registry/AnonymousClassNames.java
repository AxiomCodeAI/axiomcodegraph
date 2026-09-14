package com.axiomcode.test.typeregistry;

import java.util.Comparator;

/**
 * Acceptance fixture for anonymous class naming.
 *
 * An anonymous class is keyed by the type it extends or implements, as
 * `Outer$anon:Runnable`. The previous form numbered them `Outer$N` from the
 * running count of every type row emitted for the file, which had two problems:
 * the count included the enclosing type, so the first anonymous class was
 * `Outer$2`, and adding an unrelated NAMED nested type above renumbered every
 * anonymous type below it.
 *
 * The named nested types below are positioned deliberately: one before the
 * anonymous classes and one between them. Under the old scheme they shifted the
 * numbering of everything after them, so their presence here is what makes the
 * fixture discriminate on stability rather than only on the starting value.
 *
 * Identity is unaffected by any of this. The row's hash is position-derived, so
 * the two anonymous Runnables below are distinct rows that share a name, in the
 * same way two nested types can share a flattened qualified name.
 */
public class AnonymousClassNames {

    /** Named nested type declared BEFORE any anonymous class. */
    static class DeclaredFirst { }

    Runnable fieldAnon = new Runnable() {
        @Override public void run() { }
    };

    /** Named nested type declared BETWEEN two anonymous classes. */
    static class DeclaredBetween { }

    void methodAnons() {
        Runnable a = new Runnable() {
            @Override public void run() { }
        };

        // A second anonymous class with the same supertype: same name, distinct row.
        Runnable b = new Runnable() {
            @Override public void run() { }
        };

        // A qualified, generic supertype keys on the simple name with no type
        // arguments, so the key survives an import being rewritten or a type
        // argument being added.
        Comparator<String> c = new java.util.Comparator<String>() {
            @Override public int compare(String x, String y) { return 0; }
        };

        // extends Object rather than implementing an interface.
        Object d = new Object() { };

        a.run();
        b.run();
        c.compare("", "");
        d.toString();
    }
}
