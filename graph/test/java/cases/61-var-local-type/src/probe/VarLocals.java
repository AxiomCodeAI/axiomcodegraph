package probe;

import java.text.Format;
import java.util.Collections;
import java.util.List;
import java.util.function.BiConsumer;

/**
 * `var` is a reserved type name (JLS 14.4), so a local declared with it never has a type called
 * `var`: its type is the initializer's. Each construct below has a control written with the
 * declared type, which must resolve the same way.
 */
public class VarLocals {

    /** var from a client call's return: one known edge, no library label. */
    void fromCall(Registry r) {
        var h = r.lookup("x");
        h.handle();
    }

    /** control: the same call with the type written down. */
    void fromCallDeclared(Registry r) {
        Handler h = r.lookup("x");
        h.handle();
    }

    /** var from a static factory. */
    void fromFactory() {
        var w = Widget.create();
        w.paint();
    }

    /** control: var from `new` was already pinned to the created type. */
    void fromNew() {
        var w = new Widget();
        w.paint();
    }

    /** var from `new`, then reassigned: no longer pinned, still a Widget. */
    void fromNewReassigned() {
        var w = new Widget();
        w = Widget.create();
        w.paint();
    }

    /** var from a literal: String's own method, and nothing named var. */
    int fromLiteral() {
        var s = "abc";
        return s.length();
    }

    /** control: the literal itself, with no local; a var must answer the same way. */
    int literalInline() {
        return "abc".length();
    }

    /** control: the declared String. */
    int fromLiteralDeclared() {
        String s = "abc";
        return s.length();
    }

    /** var loop variable over a platform list (not staged): unresolved, not a library call. */
    void fromEnhancedFor(List<Widget> ws) {
        for (var x : ws) {
            x.paint();
        }
    }

    /** control: the declared loop variable. */
    void fromEnhancedForDeclared(List<Widget> ws) {
        for (Widget x : ws) {
            x.paint();
        }
    }

    /** var resource in try-with-resources. */
    void fromResource() {
        try (var w = Widget.create()) {
            w.paint();
        }
    }

    /** var from an unstaged platform call: the type is unknown, so the call stays unresolved. */
    int fromUnknown() {
        var xs = Collections.emptyList();
        return xs.size();
    }

    /** control: a declared external local still types its receiver as that external type. */
    String declaredExternal(Object o) {
        Format f = source();
        return f.format(o);
    }

    /** var from a client call declared to return an external type: that type, not `var`. */
    String varExternal(Object o) {
        var f = source();
        return f.format(o);
    }

    Format source() {
        return null;
    }

    /** var lambda parameters (Java 11). */
    BiConsumer<Widget, Widget> lambdaParams() {
        return (var a, var b) -> a.paint();
    }
}
