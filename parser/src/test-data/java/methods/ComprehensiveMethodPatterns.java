package com.inventory.auth.examples;

// Explicit imports
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.Comparator;

// Wildcard import
import java.io.*;
import java.lang.reflect.Array;

// Static imports
import static java.util.Collections.sort;

// Cross-package imports
import com.inventory.auth.domain.Session;
import com.inventory.auth.domain.User;

/**
 * Comprehensive test file covering all Java method patterns in one place:
 * - Generic bounds (single, multiple, recursive, chained)
 * - Type parameter dependencies (T extends U, U extends T in methods)
 * - Constructors with generics
 * - Arrays with generics
 * - Throws with type parameters
 * - Nested classes with type interactions
 * - Anonymous and local classes
 * - Interface default/static methods
 * - Inheritance patterns (covariant returns, bridge methods)
 * - Cross-file type dependencies
 * - Import style variations
 */
public class ComprehensiveMethodPatterns<T> {

    private T value;

    // === CONSTRUCTORS ===
    
    public ComprehensiveMethodPatterns(T value) {
        this.value = value;
    }

    public <U> ComprehensiveMethodPatterns(T t, U u) {
        this.value = t;
    }

    public <U extends T> ComprehensiveMethodPatterns(T base, U derived, Class<U> clazz) {
        this.value = base;
    }

    // === GENERIC METHOD PATTERNS ===

    public <U extends T> U selfBoundedMethod(U input) {
        return input;
    }

    public <U extends Comparable<U>> U recursiveBound(U a, U b) {
        return a.compareTo(b) > 0 ? a : b;
    }

    public <U extends Comparable<U> & Serializable> U multipleBounds(U value) {
        return value;
    }

    public <U extends T, V extends U> Map<T, Map<U, V>> chainedBounds(T t, U u, V v) {
        Map<U, V> inner = new HashMap<>();
        inner.put(u, v);
        Map<T, Map<U, V>> outer = new HashMap<>();
        outer.put(t, inner);
        return outer;
    }

    public <U extends T, V extends T> List<U> multipleBoundsBySameBase(T base, U derived1, V derived2) {
        List<U> result = new ArrayList<>();
        result.add(derived1);
        return result;
    }

    public static <U extends Comparable<? super U>> U staticGenericMethod(List<U> list) {
        return list.isEmpty() ? null : list.get(0);
    }

    // === ARRAY + GENERIC PATTERNS ===

    public <U> U[] genericArrayCreation(Class<U> clazz, int size) {
        @SuppressWarnings("unchecked")
        U[] array = (U[]) Array.newInstance(clazz, size);
        return array;
    }

    public <U> U[][] twoDimensionalArray(U[][] input) {
        return input;
    }

    public <U extends T> U[] boundedArrayMethod(Class<T> baseClass, Class<U> derivedClass, U value) {
        @SuppressWarnings("unchecked")
        U[] array = (U[]) Array.newInstance(derivedClass, 5);
        array[0] = value;
        return array;
    }

    public final <U> List<U>[] arrayOfGenericLists(@SuppressWarnings("unchecked") List<U>... lists) {
        return lists;
    }

    // === THROWS PATTERNS ===

    public <E extends Exception> void throwsGenericException(Class<E> exClass) throws E {
        throw null;
    }

    public <E extends IOException> void throwsBounded(E exception) throws E {
        throw exception;
    }

    public <U, E extends Exception> U methodWithGenericAndException(U value) throws E, IOException {
        if (value == null) throw new IOException();
        return value;
    }

    // === WILDCARD PATTERNS ===

    public void wildcardMethod(List<?> unbounded, List<? extends Number> upper, List<? super Integer> lower) {
    }

    public <U> void wildcardWithTypeParam(List<? extends U> source, List<? super U> dest) {
        for (U item : source) {
            dest.add(item);
        }
    }

    // === CROSS-FILE TYPE DEPENDENCIES ===

    public void concreteTypeMethod(Session session, User user) {
        // Uses types from different package
    }

    public <U extends Session> U boundByConcreteType(U session) {
        return session;
    }

    public <U extends User, V extends U> Map<U, V> chainedConcreteTypeBounds(U user, V derivedUser) {
        Map<U, V> map = new HashMap<>();
        map.put(user, derivedUser);
        return map;
    }

    // === NESTED CLASS PATTERNS ===

    public class Inner<U> {
        public Map<T, U> combineOuterInner(T t, U u) {
            Map<T, U> map = new HashMap<>();
            map.put(t, u);
            return map;
        }

        public <V extends T> V shadowingMethod(V input) {
            return input;
        }

        public class DeepNested<V> {
            public Map<T, Map<U, V>> tripleNesting(T t, U u, V v) {
                Map<U, V> inner = new HashMap<>();
                inner.put(u, v);
                Map<T, Map<U, V>> outer = new HashMap<>();
                outer.put(t, inner);
                return outer;
            }
        }
    }

    public static class StaticNested<U> {
        public <V extends U> Map<U, V> staticNestedMethod(U key, V value) {
            Map<U, V> map = new HashMap<>();
            map.put(key, value);
            return map;
        }
    }

    // === ANONYMOUS AND LOCAL CLASS PATTERNS ===

    public <U extends Comparable<U>> void anonymousClass(U value) {
        Comparator<U> comp = new Comparator<U>() {
            @Override
            public int compare(U o1, U o2) {
                return o1.compareTo(o2);
            }

            public <V extends U> V customMethod(V v) {
                return v;
            }
        };
        comp.compare(value, value);
    }

    public <U> void localClass(U outerValue) {
        class LocalProcessor<V extends U> {
            private V value;

            public V process(V input) {
                this.value = input;
                return value;
            }

            public <W extends V> Map<V, W> localGenericMethod(V v, W w) {
                Map<V, W> map = new HashMap<>();
                map.put(v, w);
                return map;
            }
        }

        LocalProcessor<U> processor = new LocalProcessor<>();
        processor.process(outerValue);
    }

    public <U extends Session> void localClassWithConcreteTypeBound(U session) {
        class SessionProcessor<V extends U> {
            public V processSession(V s) {
                return s;
            }
        }

        SessionProcessor<U> processor = new SessionProcessor<>();
        processor.processSession(session);
    }

    // === INTERFACE PATTERNS ===

    public interface GenericInterface<U> {
        U getValue();

        default <V> Map<U, V> defaultMethod(U key, V value) {
            Map<U, V> map = new HashMap<>();
            map.put(key, value);
            return map;
        }

        static <U, V extends U> List<V> staticInterfaceMethod(V value) {
            List<V> list = new ArrayList<>();
            list.add(value);
            return list;
        }
    }

    public interface BoundedInterface<U extends Comparable<U>> {
        default <V extends U> V boundedDefault(V value) {
            return value;
        }
    }

    // === INHERITANCE PATTERNS ===

    public static class Parent<U> {
        public U getValue() {
            return null;
        }

        public Number getNumber() {
            return 0;
        }
    }

    public static class Child extends Parent<String> {
        @Override
        public String getValue() {
            return "child";
        }

        @Override
        public Integer getNumber() {
            return 42;
        }
    }

    public static abstract class AbstractGeneric<U extends Comparable<U>> {
        public abstract U abstractMethod(U value);

        public <V extends U> V concreteGenericMethod(V value) {
            return value;
        }
    }

    public static class ConcreteImplementation extends AbstractGeneric<String> {
        @Override
        public String abstractMethod(String value) {
            return value.toUpperCase();
        }
    }

    // === IMPORT STYLE VARIATIONS ===

    public List<String> explicitImportMethod() {
        return new ArrayList<>();
    }

    public Serializable wildcardImportMethod(Serializable input) throws IOException {
        if (input == null) throw new IOException();
        return input;
    }

    public void staticImportMethod(List<Integer> numbers) {
        sort(numbers);
    }

    public java.util.concurrent.ConcurrentHashMap<String, Integer> fullyQualifiedMethod() {
        return new java.util.concurrent.ConcurrentHashMap<>();
    }

    // === STATIC INITIALIZER ===
    static {
        System.out.println("Static initializer");
    }

    // === INSTANCE INITIALIZER ===
    {
        System.out.println("Instance initializer");
    }

    // === VARARGS PATTERNS ===

    public <U> void genericVarargs(U... elements) {
    }

    public <U extends T> void boundedVarargs(U... elements) {
    }

    // === RECEIVER PARAMETER ===

    public void receiverParameterMethod(ComprehensiveMethodPatterns<T> this) {
    }

    // === OVERLOADING ===

    public void overloadedMethod() {
    }

    public void overloadedMethod(String s) {
    }

    public void overloadedMethod(String s, Integer i) {
    }

    public <U extends T> void overloadedGenericMethod(U bounded) {
    }

    // === ENUM WITH METHODS ===

    public enum Status {
        ACTIVE {
            @Override
            public String getDescription() {
                return "Active status";
            }
        },
        INACTIVE {
            @Override
            public String getDescription() {
                return "Inactive status";
            }
        };

        public abstract String getDescription();

        public <U> U genericEnumMethod(U value) {
            return value;
        }
    }

    // === ANNOTATION TYPE ===

    public @interface CustomAnnotation {
        String value() default "default";
        int count() default 0;
    }
}
