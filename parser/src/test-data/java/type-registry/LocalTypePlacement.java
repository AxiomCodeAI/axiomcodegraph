package com.axiomcode.test.typeregistry;

/**
 * Acceptance fixture for TypePlacement.LOCAL_PLACEMENT (JLS 14.3).
 *
 * A local class is not a member of the enclosing type. INNER_PLACEMENT is not a
 * vaguer answer for one, it is a different and false one: the vocabulary defines
 * INNER_PLACEMENT as a non-static inner class WITH access to an outer instance.
 * A local class in a static method or a static initializer has no outer
 * instance, and a local record can never have one, so reporting INNER_PLACEMENT
 * for those states something the language forbids.
 *
 * What decides the answer is which scope is reached first walking outward: an
 * executable body makes the type local, an enclosing type declaration makes it a
 * member. The nested cases at the bottom are here to hold that ordering, because
 * a rule that simply asked "is there a method anywhere above me" would relabel
 * every member type of a local class as local too.
 */
public class LocalTypePlacement {

    // ── LOCAL_PLACEMENT: every executable scope a local type can sit in ──

    void inInstanceMethod() {
        class InMethod { }
    }

    static void inStaticMethod() {
        // No enclosing instance exists here at all.
        class InStaticMethod { }
        record InStaticMethodRecord(int x) { }
    }

    LocalTypePlacement() {
        class InConstructor { }
    }

    {
        class InInstanceInitializer { }
    }

    static {
        class InStaticInitializer { }
    }

    void inLambda() {
        Runnable r = () -> {
            class InLambdaBody { }
        };
        r.run();
    }

    /** A local record is implicitly static, and still local rather than nested. */
    void localRecord() {
        record LocalRecord(int x) { }
    }

    /** A local interface and a local enum, both permitted since Java 16. */
    void localInterfaceAndEnum() {
        interface LocalContract { }
        enum LocalKind { ONE }
    }

    // ── Unchanged: types whose nearest enclosing scope really is a class body ──

    /** Non-static member class: genuinely has an outer instance. */
    class RealInner { }

    static class RealStaticNested { }

    interface ImplicitlyStaticContract { }

    record ImplicitlyStaticRecord(int x) { }

    // ── Ordering: a member of a local class is a member, not a local ──

    void nestingInsideALocalClass() {
        class Outer {
            class MemberOfLocal { }              // INNER_PLACEMENT
            static class StaticMemberOfLocal { } // STATIC_NESTED_PLACEMENT
            void deeper() {
                class LocalInsideLocal { }       // LOCAL_PLACEMENT again
            }
        }
    }
}
