package com.inventory.auth.examples4;

import java.io.IOException;
import java.io.Serializable;
import java.sql.SQLException;
import java.lang.annotation.*;
import java.util.List;
import java.util.Map;
import java.util.Collection;
import java.util.concurrent.CompletableFuture;

/**
 * Comprehensive examples of TYPE_USE annotations in method declarations.
 * 
 * Java 8+ allows annotations on type uses, not just declarations.
 * These annotations can appear on:
 * - Return types
 * - Parameter types
 * - Throws clause types
 * - Generic type arguments
 * - Array component types
 * - Wildcards
 */
public class TypeUseAnnotationPatterns {

    // ============================================================
    // Custom TYPE_USE annotations for testing
    // ============================================================

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface NonNull {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Nullable {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Valid {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Size {
        int min() default 0;
        int max() default Integer.MAX_VALUE;
    }

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Critical {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Immutable {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface ReadOnly {}

    @Target(ElementType.TYPE_USE)
    @Retention(RetentionPolicy.RUNTIME)
    public @interface Validated {
        Class<?> validator() default Object.class;
    }

    @Target({ElementType.TYPE_USE, ElementType.PARAMETER})
    @Retention(RetentionPolicy.RUNTIME)
    public @interface NotEmpty {}

    // ============================================================
    // RETURN TYPE ANNOTATIONS
    // ============================================================

    // Simple annotation on return type
    public @NonNull String getRequiredName() {
        return "name";
    }

    // Annotation on parameterized return type
    public @NonNull List<String> getRequiredList() {
        return List.of();
    }

    // Annotation on generic type argument of return type
    public List<@NonNull String> getListOfNonNullStrings() {
        return List.of();
    }

    // Multiple annotations on return type
    public @NonNull @Immutable String getImmutableName() {
        return "immutable";
    }

    // Annotation with arguments on return type
    public @Size(min = 1, max = 100) String getSizedString() {
        return "sized";
    }

    // Nested generic return type with annotations
    public Map<@NonNull String, @Valid List<@Size(max = 50) String>> getComplexMap() {
        return Map.of();
    }

    // Array return type with annotation
    public @NonNull String[] getRequiredArray() {
        return new String[0];
    }

    // Array component type annotation
    public String @NonNull [] getArrayWithNonNullElements() {
        return new String[0];
    }

    // Wildcard in return type with annotation
    public List<@NonNull ? extends Number> getWildcardList() {
        return List.of();
    }

    // CompletableFuture with annotated type argument
    public CompletableFuture<@NonNull String> getAsyncResult() {
        return CompletableFuture.completedFuture("result");
    }

    // ============================================================
    // PARAMETER TYPE ANNOTATIONS
    // ============================================================

    // Simple annotation on parameter type
    public void processName(@NonNull String name) {
        // process
    }

    // Annotation on generic type argument
    public void processList(List<@NonNull String> items) {
        // process
    }

    // Multiple annotations on parameter type
    public void processValidated(@NonNull @Valid String data) {
        // process
    }

    // Annotation with arguments on parameter type
    public void processSized(@Size(min = 5, max = 255) String text) {
        // process
    }

    // Complex nested annotations in parameter
    public void processComplexParam(
        Map<@NonNull String, List<@Valid @Size(max = 100) String>> complexMap
    ) {
        // process
    }

    // Multiple parameters with various annotations
    public void processMultiple(
        @NonNull String required,
        @Nullable String optional,
        List<@Valid String> validItems,
        @Size(max = 10) String limited
    ) {
        // process
    }

    // Array parameter with annotations
    public void processArray(@NonNull String @Size(min = 1) [] items) {
        // process
    }

    // Varargs with annotation
    public void processVarargs(@NonNull String... messages) {
        // process
    }

    // Wildcard parameter with annotation
    public void processWildcard(List<@NonNull ? extends Comparable<?>> items) {
        // process
    }

    // ============================================================
    // THROWS CLAUSE ANNOTATIONS
    // ============================================================

    // Single annotated exception
    public void mayThrowCritical() throws @Critical IOException {
        throw new IOException("critical");
    }

    // Multiple annotated exceptions
    public void mayThrowMultiple() throws @Critical IOException, @NonNull SQLException {
        throw new IOException("error");
    }

    // Mix of annotated and non-annotated exceptions
    public void mayThrowMixed() throws @Critical IOException, RuntimeException {
        throw new IOException("mixed");
    }

    // Annotation with arguments on exception
    public void mayThrowValidated() throws @Validated(validator = Exception.class) Exception {
        throw new Exception("validated");
    }

    // ============================================================
    // COMBINED PATTERNS
    // ============================================================

    // Return type + parameter annotations
    public @NonNull String transformName(@NonNull String input) {
        return input.toUpperCase();
    }

    // Return type + parameter + throws annotations
    public @NonNull String parseData(@NonNull @Valid String data) 
        throws @Critical IOException {
        return data;
    }

    // Full method with all annotation types
    public @NonNull @Immutable Map<@NonNull String, @Valid List<@Size(max = 50) String>> 
        processFullyAnnotated(
            @NonNull String key,
            List<@Valid @NotEmpty String> values,
            @Nullable Map<String, @NonNull Integer> options
        ) throws @Critical IOException, @NonNull SQLException {
        return Map.of();
    }

    // ============================================================
    // GENERIC METHOD TYPE PARAMETERS WITH TYPE_USE ANNOTATIONS
    // ============================================================

    // Method type parameter bound with TYPE_USE annotation
    public <T extends @NonNull Number> T processNumber(T value) {
        return value;
    }

    // Multiple bounds with annotations
    public <T extends @NonNull Comparable<T> & @Immutable Serializable> T sortableItem(T item) {
        return item;
    }

    // Return type using annotated method type parameter
    public <T> @NonNull T ensureNonNull(T value) {
        return value;
    }

    // Complex generic method with annotations
    public <K extends @NonNull String, V extends @Valid Collection<@NonNull ?>> 
        Map<K, V> createAnnotatedMap(K key, V value) {
        return Map.of(key, value);
    }

    // ============================================================
    // INNER CLASS WITH TYPE_USE ANNOTATIONS
    // ============================================================

    public class AnnotatedProcessor<T extends @NonNull Object> {
        
        // Field with TYPE_USE annotation (for completeness)
        private @NonNull T data;

        public AnnotatedProcessor(@NonNull T initialData) {
            this.data = initialData;
        }

        // Method in inner class with TYPE_USE annotations
        public @NonNull T getData() {
            return data;
        }

        public void setData(@NonNull T newData) {
            this.data = newData;
        }

        // Method with annotated wildcard
        public void processItems(List<@NonNull ? super T> items) {
            // process
        }
    }

    // ============================================================
    // STATIC METHODS WITH TYPE_USE ANNOTATIONS
    // ============================================================

    public static @NonNull String staticNonNullMethod() {
        return "static";
    }

    public static <T> @NonNull List<@Valid T> staticGenericMethod(@NonNull T item) {
        return List.of(item);
    }

    // ============================================================
    // INTERFACE WITH TYPE_USE ANNOTATIONS
    // ============================================================

    public interface AnnotatedService<T> {
        @NonNull T process(@NonNull T input) throws @Critical Exception;
        
        default @Nullable T processOptional(@Nullable T input) {
            return input;
        }

        List<@NonNull T> processAll(List<@NonNull T> items);
    }
}
