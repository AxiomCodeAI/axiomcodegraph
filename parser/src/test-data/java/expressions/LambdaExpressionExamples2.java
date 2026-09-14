package com.inventory.auth.examples20;

import java.util.Collections;
import java.util.List;
import java.util.function.IntUnaryOperator;

// Functional interfaces
@FunctionalInterface
interface Function<T, R> {
    R apply(T t);
}

@FunctionalInterface
interface BiFunction<T, U, R> {
    R apply(T t, U u);
}

@FunctionalInterface
interface Supplier<T> {
    T get();
}

public class LambdaExpressionExamples {
    // =========================================================================
    // GENERIC TYPE VARIABLES (T, U) — REAL TYPE PARAMS
    // =========================================================================

    static class GenericBox<T> {
        // Explicit type-variable in lambda param
        Function<T, T> idT = (T t) -> t;

        // Type-variable inside nested generics
        Function<List<T>, Integer> sizeOfTList = (List<T> list) -> list.size();

        // Wildcard bound using T
        Function<List<? extends T>, Integer> sizeExtendsT = list -> list.size();

        // Array of T in lambda param type
        Function<T[], Integer> tArrayLen = (T[] arr) -> arr.length;

        // Cast to T inside lambda body
        @SuppressWarnings("unchecked")
        Function<Object, T> castToT = obj -> (T) obj;
    }

    // Generic method returning a lambda typed with T
    static <T extends Number> Function<T, Double> toDoubleFn() {
        return (T n) -> n.doubleValue();
    }


    // =========================================================================
    // GENERIC METHOD REFERENCES WITH EXPLICIT TYPE ARGS
    // =========================================================================

    Supplier<List<String>> emptyViaGenericMethodRef = Collections::<String>emptyList;
    Supplier<List<String>> emptyViaListOf = List::<String>of;


    // =========================================================================
    // STRING TEMPLATES: NESTED + "->" INSIDE TEMPLATE + LAMBDA INSIDE \{...\}
    // =========================================================================

    // Note: String templates (STR."...") are a preview feature in Java 21+
    // These may not compile without --enable-preview flag
    // Commenting out for now as they require Java 21+ preview features
    /*
    // Nested template inside template
    Function<String, String> nestedTemplate =
        name -> STR."Outer[\{STR."Inner(\{name})"}]";

    // "->" appears in template *text* (should NOT confuse lambda-arrow extraction)
    Function<String, String> arrowInTemplateText =
        s -> STR."literal arrow -> \{s}";

    // A lambda appears inside the interpolation expression (introduces nested '->')
    Function<Integer, String> templateWithLambdaInInterpolation =
        n -> STR."n+1=\{((IntUnaryOperator) x -> x + 1).applyAsInt(n)}";
    */


    // =========================================================================
    // LEXICAL TRAPS FOR SCANNERS (OPTIONAL BUT STRONGLY RECOMMENDED)
    // =========================================================================

    // "->" inside a normal string literal
    Function<String, String> arrowInStringLiteral = s -> "->" + s;

    static {
        int x = 10;
        int add = x++;
    }

    static {
        int y = 20;
        int add = y++;
    }


    {
        int testing = 10000;
        int addingMan = testing++;
        System.out.println(add + " " + testing);
    }

    // "->" inside a text block (Java 15+)
    Function<String, String> arrowInTextBlock = s -> """
        here is an arrow: ->
        value=%s
        """.formatted(s);

    // Comment between tokens
    Function<Integer, Integer> commentAroundArrow = x /*param*/ -> /*body*/ x + 1;

    // Arrow on next line
    Function<Integer, Integer> arrowOnNextLine = x
        -> x + 1;

    // Tight spacing around >> (generic close) and -> (arrow)
    Function<List<List<Integer>>, Integer> tightSpacing =
        (List<List<Integer>>list)->list.size();

    // Generic-close '>>' plus shift '>>' in body in the same lambda
    Function<List<List<Integer>>, Integer> genericCloseAndShift =
        (List<List<Integer>> list) -> list.size() >> 1;

    // Unsigned shift (you currently only have >>)
    BiFunction<Integer, Integer, Integer> unsignedRightShift = (a, b) -> a >>> b;


    @SafeVarargs
    public int add(List<Integer> list, int b) throws Exception {
        return list.stream().mapToInt(Integer::intValue).sum() + b;
    }
}
