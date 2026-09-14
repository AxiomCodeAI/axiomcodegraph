package com.axiomcode.test.methods;

/**
 * Acceptance fixture for the default constructor of JLS 8.8.9.
 *
 * A class that declares no constructor gets one implicitly, and it takes the
 * access of the class itself - a package-private class does not get a public
 * constructor. Interfaces and annotation types get none at all, which is the
 * half a "synthesise a constructor for every type" rule would get wrong.
 *
 * Per `javap -p`: Plain() is public, PackagePrivate() is package-private,
 * Abstract() is public, Declared has only Declared(int), and neither Contract
 * nor Marker has any constructor.
 */
public class DefaultConstructors {

    /** Public class, no constructor: implicit public no-arg constructor. */
    public static class Plain {
        private int count;
    }

    /** Package-private class: the implicit constructor is package-private too. */
    static class PackagePrivate {
    }

    /** An abstract class still gets one, despite never being instantiated directly. */
    public abstract static class Abstract {
        public abstract void go();
    }

    /** Declares a constructor, so nothing is implicit. There is exactly one. */
    public static class Declared {
        public Declared(int value) {
        }
    }

    /** An interface has no constructor at all. */
    public interface Contract {
        void go();
    }

    /** Nor does an annotation type. */
    public @interface Marker {
        String value() default "";
    }
}
