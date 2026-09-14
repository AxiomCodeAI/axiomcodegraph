package com.inventory.auth.examples;

// Explicit imports
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.HashSet;

// Wildcard import
import java.io.*;

// Static imports
import static java.util.Collections.sort;
import static java.util.Collections.emptyList;
import static java.util.Collections.singletonList;
import static java.lang.Math.max;
import static java.lang.Math.min;

// Fully qualified names (no import)
// java.util.concurrent.ConcurrentHashMap

/**
 * Test file demonstrating different import styles and their impact on
 * type resolution in method signatures
 */
public class ImportStylePatterns {

    public List<String> explicitImportMethod() {
        return new ArrayList<>();
    }

    public Map<Integer, String> explicitMapMethod() {
        Map<Integer, String> map = new HashMap<>();
        return map;
    }

    public Set<Double> explicitSetMethod() {
        return new HashSet<>();
    }

    public Serializable wildcardImportMethod(Serializable input) throws IOException {
        if (input == null) throw new IOException("Null input");
        return input;
    }

    public InputStream inputStreamMethod(InputStream stream) throws IOException {
        return stream;
    }

    public OutputStream outputStreamMethod() {
        return new ByteArrayOutputStream();
    }

    public void staticImportMethod(List<Integer> numbers) {
        sort(numbers);
        int maximum = max(numbers.get(0), numbers.get(1));
        int minimum = min(numbers.get(0), numbers.get(1));
    }

    public List<String> staticImportReturn() {
        return emptyList();
    }

    public List<String> staticSingletonList(String value) {
        return singletonList(value);
    }

    public java.util.concurrent.ConcurrentHashMap<String, Integer> fullyQualifiedMethod() {
        return new java.util.concurrent.ConcurrentHashMap<>();
    }

    public java.util.concurrent.atomic.AtomicInteger fullyQualifiedAtomic() {
        return new java.util.concurrent.atomic.AtomicInteger(0);
    }

    public java.sql.Connection fullyQualifiedSql() throws java.sql.SQLException {
        return null;
    }

    public <T extends Serializable> T genericWithWildcardImport(T value) throws IOException {
        if (value == null) throw new IOException();
        return value;
    }

    public <T> List<T> mixedImportStyle(T value) {
        List<T> list = new ArrayList<>();
        list.add(value);
        sort((List) list);
        return list;
    }

    public Map<String, List<Set<Integer>>> nestedWithExplicitImports() {
        Map<String, List<Set<Integer>>> result = new HashMap<>();
        Set<Integer> set = new HashSet<>();
        set.add(1);
        List<Set<Integer>> list = new ArrayList<>();
        list.add(set);
        result.put("key", list);
        return result;
    }

    public java.util.stream.Stream<String> fullyQualifiedStream(List<String> input) {
        return input.stream();
    }

    public java.util.function.Function<String, Integer> fullyQualifiedFunction() {
        return s -> s.length();
    }

    public java.util.Optional<String> fullyQualifiedOptional(String value) {
        return java.util.Optional.ofNullable(value);
    }

    public static class NestedWithDifferentImports {
        public List<String> usesExplicitImport() {
            return new ArrayList<>();
        }

        public Serializable usesWildcardImport(Serializable input) {
            return input;
        }

        public java.util.Queue<Integer> usesFullyQualified() {
            return new java.util.LinkedList<>();
        }
    }

    public interface InterfaceWithImportVariations {
        List<String> explicitMethod();

        java.util.Deque<Integer> fullyQualifiedMethod();

        Serializable wildcardMethod(Serializable input) throws IOException;
    }

    public static class Implementation implements InterfaceWithImportVariations {
        @Override
        public List<String> explicitMethod() {
            return emptyList();
        }

        @Override
        public java.util.Deque<Integer> fullyQualifiedMethod() {
            return new java.util.ArrayDeque<>();
        }

        @Override
        public Serializable wildcardMethod(Serializable input) throws IOException {
            return input;
        }
    }

    public enum EnumWithImports {
        OPTION1, OPTION2;

        public List<String> getExplicitList() {
            return new ArrayList<>();
        }

        public java.util.TreeSet<Integer> getFullyQualifiedSet() {
            return new java.util.TreeSet<>();
        }
    }
}
