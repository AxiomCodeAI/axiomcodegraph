package com.inventory.auth.examples;

import java.lang.reflect.Array;
import java.util.List;
import java.util.ArrayList;

/**
 * Test file for array and generic combination patterns including:
 * - Generic array creation
 * - Multi-dimensional generic arrays
 * - Array of wildcards
 * - Generic varargs with arrays
 */
public class ArrayGenericPatterns {

    @SuppressWarnings("unchecked")
    public <T> T[] genericArrayCreation(Class<T> clazz, int size) {
        return (T[]) Array.newInstance(clazz, size);
    }

    public <T> T[][] twoDimensionalGeneric(T[][] input) {
        return input;
    }

    @SuppressWarnings("unchecked")
    public <T> T[][] create2DArray(Class<T> clazz, int rows, int cols) {
        return (T[][]) Array.newInstance(clazz, rows, cols);
    }

    public <T> T[][][] threeDimensionalGeneric(T[][][] input) {
        return input;
    }

    public List<?>[] arrayOfWildcardLists() {
        @SuppressWarnings("unchecked")
        List<?>[] array = (List<?>[]) new List<?>[10];
        return array;
    }

    public List<? extends Number>[] arrayOfBoundedWildcards(int size) {
        @SuppressWarnings("unchecked")
        List<? extends Number>[] array = (List<? extends Number>[]) new List<?>[size];
        return array;
    }

    public List<? super Integer>[] arrayOfLowerBoundedWildcards(int size) {
        @SuppressWarnings("unchecked")
        List<? super Integer>[] array = (List<? super Integer>[]) new List<?>[size];
        return array;
    }

    @SafeVarargs
    public final <T> List<T>[] arrayOfGenericLists(List<T>... lists) {
        return lists;
    }

    @SafeVarargs
    public final <T> T[][] varargsMultiDimensional(T[]... arrays) {
        return arrays;
    }

    public <T extends Comparable<T>> T[] sortedArrayCreation(Class<T> clazz, int size) {
        @SuppressWarnings("unchecked")
        T[] array = (T[]) Array.newInstance(clazz, size);
        return array;
    }

    @SafeVarargs
    public final <T extends Number> T[] numberArrayFromVarargs(T... numbers) {
        return numbers;
    }

    public <T> T[] concatenateArrays(T[] first, T[] second) {
        @SuppressWarnings("unchecked")
        T[] result = (T[]) Array.newInstance(
            first.getClass().getComponentType(),
            first.length + second.length
        );
        System.arraycopy(first, 0, result, 0, first.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }

    public <T> List<T[]> listOfArrays(int size) {
        return new ArrayList<>();
    }

    public <T> T[][] transposeMatrix(T[][] matrix, Class<T> clazz) {
        if (matrix.length == 0) return matrix;
        int rows = matrix.length;
        int cols = matrix[0].length;
        
        @SuppressWarnings("unchecked")
        T[][] transposed = (T[][]) Array.newInstance(clazz, cols, rows);
        
        for (int i = 0; i < rows; i++) {
            for (int j = 0; j < cols; j++) {
                transposed[j][i] = matrix[i][j];
            }
        }
        return transposed;
    }

    @SafeVarargs
    public static <T> T[] staticGenericVarargs(T... elements) {
        return elements;
    }

    public <T> T[] filterArray(T[] array, Class<T> clazz) {
        List<T> filtered = new ArrayList<>();
        for (T elem : array) {
            if (elem != null) {
                filtered.add(elem);
            }
        }
        @SuppressWarnings("unchecked")
        T[] result = (T[]) Array.newInstance(clazz, filtered.size());
        return filtered.toArray(result);
    }
}
