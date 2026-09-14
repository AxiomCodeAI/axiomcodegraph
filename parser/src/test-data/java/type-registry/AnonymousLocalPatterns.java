package com.inventory.auth.examples;

import java.util.*;

import com.inventory.auth.domain.Session;
import com.inventory.auth.domain.User;

import java.io.Serializable;
/**
 * Test file for anonymous and local class patterns including:
 * - Anonymous classes with method overrides
 * - Local classes with generics
 * - Anonymous generic interfaces
 */
public class AnonymousLocalPatterns {

    public void anonymousClassMethods() {
        Comparable<String> comp = new Comparable<String>() {
            @Override
            public int compareTo(String o) {
                return 0;
            }
        };
        comp.compareTo("test");
    }

    public void tempFunc(final Session session) {
    }

    public void methodExec(final User user) {
    }

    public <T extends Comparable<T>> T anonymousWithGeneric(T a, T b) {
        Comparator<T> comparator = new Comparator<T>() {
            @Override
            public int compare(T o1, T o2) {
                return o1.compareTo(o2);
            }
        };
        return comparator.compare(a, b) >= 0 ? a : b;
    }

    public void anonymousListImplementation() {
        List<String> list = new ArrayList<String>() {
            @Override
            public boolean add(String e) {
                System.out.println("Adding: " + e);
                return super.add(e);
            }

            @Override
            public String get(int index) {
                System.out.println("Getting: " + index);
                return super.get(index);
            }
        };
        list.add("test");
    }

    public <T> void methodWithLocalClass(T value) {
        class LocalClass<U> {
            private T outerValue;
            private U innerValue;

            public LocalClass(T outer, U inner) {
                this.outerValue = outer;
                this.innerValue = inner;
            }

            public T getOuterValue() {
                return outerValue;
            }

            public U getInnerValue() {
                return innerValue;
            }

            public <V> Map<U, V> localMethod(U u, V v) {
                Map<U, V> map = new HashMap<>();
                map.put(u, v);
                return map;
            }
        }

        LocalClass<String> local = new LocalClass<>(value, "test");
        local.getOuterValue();
    }

    public void localClassWithBounds() {
        class BoundedLocal<T extends Number & Comparable<T>> {
            public T max(T a, T b) {
                return a.compareTo(b) >= 0 ? a : b;
            }

            public <U extends T> U boundedMethod(U value) {
                return value;
            }
        }

        BoundedLocal<Integer> local = new BoundedLocal<>();
        local.max(1, 2);
    }

    public <T> void nestedLocalClasses(T value) {
        class OuterLocal<U> {
            class InnerLocal<V> {
                public Map<T, Map<U, V>> tripleNesting(T t, U u, V v) {
                    Map<U, V> inner = new HashMap<>();
                    inner.put(u, v);
                    Map<T, Map<U, V>> outer = new HashMap<>();
                    outer.put(t, inner);
                    return outer;
                }
            }
        }
    }

    public void anonymousMapImplementation() {
        Map<String, Integer> map = new HashMap<String, Integer>() {
            @Override
            public Integer put(String key, Integer value) {
                System.out.println("Putting: " + key + " = " + value);
                return super.put(key, value);
            }

            @Override
            public Integer get(Object key) {
                Integer val = super.get(key);
                System.out.println("Getting: " + key + " = " + val);
                return val;
            }
        };
        map.put("key", 1);
    }

    public <T extends Serializable> void localClassCapturingGeneric(T value) {
        class CapturingLocal {
            public T getValue() {
                return value;
            }

            public <U> Map<T, U> createMap(U u) {
                Map<T, U> map = new HashMap<>();
                map.put(value, u);
                return map;
            }
        }

        CapturingLocal local = new CapturingLocal();
        local.getValue();
    }

    public void anonymousAbstractClass() {
        abstract class AbstractLocal<T> {
            public abstract T process(T input);
        }

        AbstractLocal<String> impl = new AbstractLocal<String>() {
            @Override
            public String process(String input) {
                return input.toUpperCase();
            }
        };
        impl.process("test");
    }

    public <T> Comparator<T> anonymousComparatorReturn() {
        return new Comparator<T>() {
            @Override
            public int compare(T o1, T o2) {
                return 0;
            }
        };
    }

    public void localClassInLoop() {
        for (int i = 0; i < 3; i++) {
            final int index = i;
            class LoopLocal<T> {
                public int getIndex() {
                    return index;
                }

                public <U> Map<Integer, U> createIndexedMap(U value) {
                    Map<Integer, U> map = new HashMap<>();
                    map.put(index, value);
                    return map;
                }
            }

            LoopLocal<String> local = new LoopLocal<>();
            local.getIndex();
        }
    }

    public <T extends Comparable<T>> void anonymousWithMultipleBounds() {
        Comparator<T> comp = new Comparator<T>() {
            @Override
            public int compare(T o1, T o2) {
                return o1.compareTo(o2);
            }

            public <U extends Comparable<U> & Serializable> U customMethod(U value) {
                return value;
            }
        };
        comp.compare(null, null);
    }

    public <T extends AllMethodExamples> T concreteTypeBound(T example, String value) {
        example.publicInstanceMethod();
        return example;
    }

    public void anonymousWithConcreteType(AllMethodExamples example) {
        Comparator<AllMethodExamples> comparator = new Comparator<AllMethodExamples>() {
            @Override
            public int compare(AllMethodExamples o1, AllMethodExamples o2) {
                return o1.toString().compareTo(o2.toString());
            }
        };
        comparator.compare(example, example);
    }

    public <T extends AllMethodExamples> void localClassWithConcreteTypeBound(T example) {
        class LocalProcessor<U extends T> {
            private U value;

            public LocalProcessor(U value) {
                this.value = value;
            }

            public U process() {
                value.publicInstanceMethod();
                return value;
            }

            public <V extends U> Map<U, V> createMapping(V derived) {
                Map<U, V> map = new HashMap<>();
                map.put(value, derived);
                return map;
            }
        }

        LocalProcessor<T> processor = new LocalProcessor<>(example);
        processor.process();
    }

    public List<AllMethodExamples> anonymousListOfConcreteType() {
        return new ArrayList<AllMethodExamples>() {
            @Override
            public boolean add(AllMethodExamples e) {
                e.publicInstanceMethod();
                return super.add(e);
            }
        };
    }

    public <T extends AllMethodExamples, U> Map<T, U> genericWithConcreteTypeBound(T key, U value) {
        class MapBuilder<K extends T, V extends U> {
            public Map<K, V> build(K k, V v) {
                k.publicInstanceMethod();
                Map<K, V> result = new HashMap<>();
                result.put(k, v);
                return result;
            }
        }

        MapBuilder<T, U> builder = new MapBuilder<>();
        return builder.build(key, value);
    }

    public <T extends AllMethodExamples> Comparator<T> createComparatorForConcreteType() {
        return new Comparator<T>() {
            @Override
            public int compare(T o1, T o2) {
                o1.publicInstanceMethod();
                o2.publicInstanceMethod();
                return 0;
            }
        };
    }

    public void nestedAnonymousWithConcreteType(AllMethodExamples outer) {
        List<AllMethodExamples> list = new ArrayList<AllMethodExamples>() {
            @Override
            public AllMethodExamples get(int index) {
                AllMethodExamples result = super.get(index);
                result.publicInstanceMethod();
                return result;
            }
        };

        Map<String, AllMethodExamples> map = new HashMap<String, AllMethodExamples>() {
            @Override
            public AllMethodExamples put(String key, AllMethodExamples value) {
                value.publicInstanceMethod();
                return super.put(key, value);
            }
        };
    }
}
