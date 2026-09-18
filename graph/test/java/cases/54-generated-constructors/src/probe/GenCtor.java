package probe;

import java.util.ArrayList;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.NonNull;
import lombok.RequiredArgsConstructor;

/**
 * CONSTRUCTORS an annotation processor declares. The class carries only the implicit
 * no-arg constructor in the IR, so `new X(a, b)` matches no declaration and the
 * object's creation is absent from the graph.
 */
public class GenCtor {

    /** SUBJECT A: every non-static instance field becomes a parameter. Arity 2. */
    @AllArgsConstructor
    public static class AllArgs {
        private String error;
        private int code;
        private static String SHARED = "s";
    }

    /** SUBJECT B: only the fields that must be set. `seen` is final AND initialised,
     *  so it is NOT a parameter, which is the case that would overstate arity. */
    @RequiredArgsConstructor
    public static class Required {
        private final String id;
        @NonNull private String name;
        private final List<String> seen = new ArrayList<>();
        private int mutable;
    }

    /** SUBJECT C: a no-arg constructor on a class that also declares fields. */
    @NoArgsConstructor
    public static class NoArgs {
        private String a;
        private String b;
    }

    /** SUBJECT D: @Data implies the required-args shape. Arity 1. */
    @Data
    public static class DataHolder {
        private final String key;
        private int count;
    }

    /** SUBJECT E: @Builder declares an all-args constructor. Arity 2. */
    @Builder
    public static class Built {
        private String left;
        private String right;
    }

    /** CONTROL A: a HAND-WRITTEN constructor of the same arity must win. */
    @AllArgsConstructor
    public static class Explicit {
        private String only;

        public Explicit(String only) {
            this.only = only;
        }
    }

    /** CONTROL B: no processor annotation at all. */
    public static class Plain {
        private String v;

        public Plain(String v) {
            this.v = v;
        }
    }

    public Object make() {
        Object a = new AllArgs("bad", 7);
        Object b = new Required("id-1", "name");
        Object c = new NoArgs();
        Object d = new DataHolder("k");
        Object e = new Built("l", "r");
        Object f = new Explicit("x");
        Object g = new Plain("y");
        return a;
    }
}
