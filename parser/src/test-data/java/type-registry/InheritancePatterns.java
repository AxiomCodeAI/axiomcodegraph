package com.inventory.auth.examples;

import java.util.*;

/**
 * Test file for inheritance patterns including:
 * - Bridge methods (compiler generated)
 * - Covariant return types
 * - Generic inheritance hierarchies
 * - Method overriding with generics
 */
public class InheritancePatterns {

    public static class Parent {
        public Number getValue() {
            return 1;
        }

        public List<String> getList() {
            return new ArrayList<>();
        }

        public Object process(Object input) {
            return input;
        }
    }

    public static class Child extends Parent {
        @Override
        public Integer getValue() {
            return 42;
        }

        @Override
        public ArrayList<String> getList() {
            return new ArrayList<>();
        }

        @Override
        public String process(Object input) {
            return input.toString();
        }
    }

    public static class GrandChild extends Child {
        @Override
        public Integer getValue() {
            return 100;
        }
    }

    public static abstract class GenericParent<T> {
        public abstract T getValue();

        public abstract List<T> getList();

        public T process(T input) {
            return input;
        }

        public <U> Map<T, U> createMap(T key, U value) {
            Map<T, U> map = new HashMap<>();
            map.put(key, value);
            return map;
        }
    }

    public static class GenericChild extends GenericParent<String> {
        @Override
        public String getValue() {
            return "value";
        }

        @Override
        public List<String> getList() {
            return new ArrayList<>();
        }

        @Override
        public String process(String input) {
            return input.toUpperCase();
        }
    }

    public static class GenericChild2<T> extends GenericParent<T> {
        private T value;

        @Override
        public T getValue() {
            return value;
        }

        @Override
        public List<T> getList() {
            List<T> list = new ArrayList<>();
            list.add(value);
            return list;
        }
    }

    public static class BoundedGenericChild<T extends Number> extends GenericParent<T> {
        private T value;

        @Override
        public T getValue() {
            return value;
        }

        @Override
        public List<T> getList() {
            return Collections.singletonList(value);
        }

        @Override
        public T process(T input) {
            return input;
        }
    }

    public static class CustomList<E> extends ArrayList<E> {
        @Override
        public E get(int index) {
            System.out.println("Getting index: " + index);
            return super.get(index);
        }

        @Override
        public boolean add(E e) {
            System.out.println("Adding: " + e);
            return super.add(e);
        }
    }

    public static class StringList extends CustomList<String> {
        @Override
        public String get(int index) {
            return super.get(index);
        }

        @Override
        public boolean add(String e) {
            System.out.println("StringList adding: " + e);
            return super.add(e);
        }
    }

    public interface GenericInterface<T> {
        T process(T input);
        
        List<T> processList(List<T> input);
    }

    public static class ConcreteImplementation implements GenericInterface<String> {
        @Override
        public String process(String input) {
            return input.toLowerCase();
        }

        @Override
        public List<String> processList(List<String> input) {
            List<String> result = new ArrayList<>();
            for (String s : input) {
                result.add(s.toLowerCase());
            }
            return result;
        }
    }

    public static class GenericImplementation<T> implements GenericInterface<T> {
        @Override
        public T process(T input) {
            return input;
        }

        @Override
        public List<T> processList(List<T> input) {
            return new ArrayList<>(input);
        }
    }

    public static abstract class MultiLevelParent<T, U> {
        public abstract Map<T, U> getMap();

        public abstract T getKey();

        public abstract U getValue();
    }

    public static abstract class MultiLevelMiddle<T> extends MultiLevelParent<T, String> {
        @Override
        public String getValue() {
            return "middle";
        }
    }

    public static class MultiLevelChild extends MultiLevelMiddle<Integer> {
        @Override
        public Map<Integer, String> getMap() {
            return new HashMap<>();
        }

        @Override
        public Integer getKey() {
            return 42;
        }
    }

    public static class CovariantArrays {
        public Number[] getNumbers() {
            return new Number[]{1, 2, 3};
        }
    }

    public static class CovariantArraysChild extends CovariantArrays {
        @Override
        public Integer[] getNumbers() {
            return new Integer[]{1, 2, 3};
        }
    }

    public static class GenericHierarchy<T extends Comparable<T>> {
        public T max(T a, T b) {
            return a.compareTo(b) >= 0 ? a : b;
        }

        public List<T> sort(List<T> list) {
            List<T> sorted = new ArrayList<>(list);
            Collections.sort(sorted);
            return sorted;
        }
    }

    public static class StringHierarchy extends GenericHierarchy<String> {
        @Override
        public String max(String a, String b) {
            return super.max(a, b);
        }

        @Override
        public List<String> sort(List<String> list) {
            List<String> sorted = super.sort(list);
            return sorted;
        }
    }
}
