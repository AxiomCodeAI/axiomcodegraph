package torture;

// f08 — NESTING. Inner, static nested, local and anonymous classes, and the outward resolution an
// unqualified call performs when the name is not declared where it is written.

import java.util.concurrent.Callable;

public class F08Nesting {

    private String outerField() { return "outer"; }
    private static String outerStatic() { return "static"; }

    class Inner {                                     // inner: holds an outer instance
        String reachOut() { return outerField(); }    // unqualified, resolves OUTWARD
        String reachStatic() { return outerStatic(); }
        String qualified() { return F08Nesting.this.outerField(); }   // qualified this
    }

    static class Nested {                             // static nested: no outer instance
        String own() { return "nested"; }
        String reachStatic() { return outerStatic(); }
    }

    class Middle {
        class Deep {
            String twoLevelsOut() { return outerField(); }   // through TWO enclosing scopes
        }
    }

    String viaLocalClass() {
        class Local { String run() { return outerField(); } }   // local class, captures the enclosing instance
        return new Local().run();
    }

    String viaAnonymous() {
        Callable<String> c = new Callable<>() {                 // anonymous, keyed by supertype
            @Override public String call() { return outerField(); }
        };
        try { return c.call(); } catch (Exception e) { return ""; }
    }

    String viaInner() { return new Inner().reachOut(); }
    String viaNested() { return new Nested().own(); }
    String viaDeep() { return new Middle().new Deep().twoLevelsOut(); }
}
