package probe;

import java.text.Format;
import java.util.Collections;
import java.util.List;
import java.util.function.BiConsumer;
import java.util.function.BiFunction;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.ToIntFunction;

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

    /** var over an array: the component type. */
    void fromArray(Widget[] ws) {
        for (var x : ws) {
            x.paint();
        }
    }

    /** var over a client generic that implements Iterable<T>: T as written on the declaration. */
    void fromClientIterable(Bag<Widget> bag) {
        for (var x : bag) {
            x.paint();
        }
    }

    /** var over a list whose type argument is a wildcard: its bound. */
    void fromWildcardList(List<? extends Widget> ws) {
        for (var x : ws) {
            x.paint();
        }
    }

    /**
     * control: a raw List has no element type. x is an Object, and Widget's hashCode must not be
     * picked for it.
     */
    @SuppressWarnings("rawtypes")
    int fromRawList(List raw) {
        int n = 0;
        for (var x : raw) {
            n += x.hashCode();
        }
        return n;
    }

    /** var resource in try-with-resources: the implicit close() at the end is a call. */
    void fromResource() {
        try (var w = Widget.create()) {
            w.paint();
        }
    }

    /** control: the declared resource closes the same way. */
    void fromResourceDeclared() {
        try (Widget w = Widget.create()) {
            w.paint();
        }
    }

    /** two resources, closed in reverse order: one close() each. */
    void twoResources() {
        try (var a = new Widget(); var b = Widget.create()) {
            a.paint();
        }
    }

    /**
     * control: a var resource whose initializer is an unstaged platform call. Its type is unknown,
     * so there is no close() edge at all, and in particular not Widget's, the only client close().
     */
    long fromResourceUnknown() {
        try (var s = java.util.stream.Stream.of(1)) {
            return s.count();
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

    /** the same with implicit parameters. */
    BiConsumer<Widget, Widget> lambdaImplicit() {
        return (a, b) -> b.paint();
    }

    /** a lambda assigned to a declared local. */
    void lambdaLocal(Widget w) {
        Consumer<Widget> c = x -> x.paint();
        c.accept(w);
    }

    /** a lambda passed to a client method whose parameter is `Consumer<? super Widget>`. */
    void lambdaArgument() {
        each(x -> x.paint());
    }

    void each(Consumer<? super Widget> c) {
    }

    /** control: the second type argument feeds the second parameter, not the first. */
    BiFunction<Widget, Gadget, Widget> lambdaSecondArgument() {
        return (a, b) -> {
            b.paint();
            return a;
        };
    }

    /** control: Function's second type argument is its result, never its parameter. */
    Function<Gadget, Widget> lambdaResultArgument() {
        return g -> {
            g.paint();
            return Widget.create();
        };
    }

    /**
     * control: a functional interface the table does not list. Its parameter stays untyped, so
     * the call on it is a declared unknown rather than a guess.
     */
    ToIntFunction<Widget> lambdaUnknownInterface() {
        return x -> x.toString().length();
    }
}
