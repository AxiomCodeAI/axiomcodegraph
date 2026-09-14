package com.inventory.auth.examples3;

import java.io.IOException;
import java.io.Serializable;
import java.lang.annotation.*;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.function.*;

import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/**
 * Spring REST Controller - Generics Torture Test for Method Parameters
 * 
 * This controller demonstrates EXTREME generic complexity on METHOD PARAMETERS:
 * - Type parameter annotations (@TypeAnno, @Validated, @MultiValidator)
 * - Recursive bounds (T extends Comparable<T>)
 * - Intersection types (T extends A & B & C)
 * - Annotated bounds (@TypeAnno on bounds)
 * - Wildcard parameters (?, extends, super)
 * - Method-level type parameter shadowing
 * - Nested generics in parameters
 * - Java 17+ records and sealed types
 * - Spring REST endpoint patterns with complex generics
 */
@RestController
@RequestMapping("/api/v1/generics-torture")
@SuppressWarnings({"unchecked", "rawtypes"})
public class Java17PlusTypes<@TypeAnno("ControllerLevel") T extends Comparable<T>> {

    // ===================================================================
    // ENDPOINT 1: Simple Annotated Type Parameter on Method
    // ===================================================================
    @GetMapping("/simple/{id}")
    public <@TypeAnno("SimpleMethod") E> ResponseEntity<E> simpleAnnotated(
            @PathVariable String id,
            @RequestBody E element) {
        return ResponseEntity.ok(element);
    }

    // ===================================================================
    // ENDPOINT 2: Recursive Type Bound - T extends Comparable<T>
    // Classic recursive generic pattern on parameter
    // ===================================================================
    @PostMapping("/recursive-bound")
    public <@TypeAnno("RecursiveBound") R extends Comparable<R>> 
            ResponseEntity<R> recursiveBound(
                    @RequestBody R value,
                    @RequestParam(required = false) R compareWith) {
        if (compareWith != null && value.compareTo(compareWith) > 0) {
            return ResponseEntity.ok(value);
        }
        return ResponseEntity.ok(compareWith != null ? compareWith : value);
    }

    // ===================================================================
    // ENDPOINT 3: Intersection Type Bounds (Multiple Bounds with &)
    // T extends Number & Comparable<T> & Serializable
    // ===================================================================
    @PostMapping("/intersection-bounds")
    public <@TypeAnno("Intersection") I extends Number & Comparable<I> & Serializable>
            ResponseEntity<List<I>> intersectionBounds(
                    @RequestBody List<I> numbers,
                    @RequestParam boolean sort) throws IOException {
        if (sort) {
            Collections.sort(numbers);
        }
        return ResponseEntity.ok(numbers);
    }

    // ===================================================================
    // ENDPOINT 4: Annotated Bounds - Annotation ON the bound type
    // @TypeAnno appears on the BOUND, not just the parameter
    // ===================================================================
    @PostMapping("/annotated-bounds")
    public <R extends @TypeAnno("BoundAnnotation") Number & Comparable<R> & Serializable>
            ResponseEntity<R> annotatedBounds(
                    @RequestBody R value,
                    @RequestHeader(value = "X-Multiplier", defaultValue = "1") int multiplier) {
        return ResponseEntity.ok(value);
    }

    // ===================================================================
    // ENDPOINT 5: Distinction - Annotation ON parameter vs ON bound
    // Shows @TypeAnno on BOTH the parameter AND the bound
    // ===================================================================
    @GetMapping("/annotation-distinction/{type}")
    public <
        @TypeAnno("OnParameter") P extends @TypeAnno("OnBound") Number
    > ResponseEntity<Map<String, P>> annotationDistinction(
            @PathVariable String type,
            @RequestBody P param,
            @RequestParam(defaultValue = "default") String key) {
        return ResponseEntity.ok(Map.of(key, param));
    }

    // ===================================================================
    // ENDPOINT 6: Class Reference in Annotation Argument
    // @Validated contains Class<?> references in annotation args
    // ===================================================================
    @PostMapping("/validated-container")
    public <
        @Validated(validator = StringValidator.class) S,
        @Validated(validator = NumberValidator.class, groups = ValidationGroup.class) N
    > ResponseEntity<Container<S, N>> validatedContainer(
            @RequestBody S stringValue,
            @RequestParam N numberValue) {
        return ResponseEntity.ok(new Container<>(stringValue, numberValue));
    }

    // ===================================================================
    // ENDPOINT 7: Array of Class References in Annotation
    // @MultiValidator uses Class<?>[] array
    // ===================================================================
    @PostMapping("/multi-validator")
    public <
        @MultiValidator(validators = {QuickValidator.class, FullValidator.class, DetailedValidator.class}) E
    > ResponseEntity<List<E>> multiValidator(
            @RequestBody List<E> elements,
            @RequestParam(defaultValue = "quick") String validationType) {
        return ResponseEntity.ok(elements);
    }

    // ===================================================================
    // ENDPOINT 8: Nested Annotations on Type Parameters
    // @Wrapper contains inner @TypeAnno
    // ===================================================================
    @PostMapping("/nested-annotations")
    public <
        @Wrapper(inner = @TypeAnno("NestedValue")) K
    > ResponseEntity<Map<K, Object>> nestedAnnotations(
            @RequestBody K key,
            @RequestParam Object value) {
        return ResponseEntity.ok(Map.of(key, value));
    }

    // ===================================================================
    // ENDPOINT 9: Enum Constant in Annotation Argument
    // @RetentionTest uses enum value
    // ===================================================================
    @GetMapping("/enum-test")
    public <
        @RetentionTest(policy = RetentionPolicy.RUNTIME) R
    > ResponseEntity<R> enumTest(
            @RequestParam R value) {
        return ResponseEntity.ok(value);
    }

    // ===================================================================
    // ENDPOINT 10: Mixed Annotations - Simple + Complex
    // ===================================================================
    @PostMapping("/mixed-annotations")
    public <
        @TypeAnno("Simple") A,
        @Validated(validator = CustomValidator.class, 
                   groups = ValidationGroup.class,
                   message = "Invalid") C
    > ResponseEntity<Pair<A, C>> mixedAnnotations(
            @RequestBody A first,
            @RequestParam C second) {
        return ResponseEntity.ok(new Pair<>(first, second));
    }

    // ===================================================================
    // ENDPOINT 11: Multiple Method-Level Type Parameters with Annotations
    // ===================================================================
    @PostMapping("/process-validation")
    public <
        @TypeAnno("MethodLevel") M,
        @Validated(validator = MethodValidator.class) V
    > ResponseEntity<M> processWithValidation(
            @RequestBody V value,
            @RequestParam M metadata) {
        return ResponseEntity.ok(metadata);
    }

    // ===================================================================
    // ENDPOINT 12: Wildcard Parameters - Unbounded
    // ===================================================================
    @PostMapping("/wildcard-unbounded")
    public ResponseEntity<Integer> wildcardUnbounded(
            @RequestBody List<?> items) {
        return ResponseEntity.ok(items.size());
    }

    // ===================================================================
    // ENDPOINT 13: Wildcard Parameters - Upper Bounded
    // ===================================================================
    @PostMapping("/wildcard-upper")
    public ResponseEntity<Double> wildcardUpper(
            @RequestBody List<? extends Number> numbers) {
        double sum = numbers.stream()
                .mapToDouble(Number::doubleValue)
                .sum();
        return ResponseEntity.ok(sum);
    }

    // ===================================================================
    // ENDPOINT 14: Wildcard Parameters - Lower Bounded
    // ===================================================================
    @PostMapping("/wildcard-lower")
    public ResponseEntity<Void> wildcardLower(
            @RequestBody List<? super Integer> container,
            @RequestParam int value) {
        container.add(value);
        return ResponseEntity.ok().build();
    }

    // ===================================================================
    // ENDPOINT 15: Nested Wildcard in Parameters
    // ===================================================================
    @PostMapping("/wildcard-nested")
    public ResponseEntity<Map<String, ?>> wildcardNested(
            @RequestBody Map<? extends String, ? extends List<? extends Number>> nestedMap) {
        return ResponseEntity.ok(Collections.unmodifiableMap(nestedMap));
    }

    // ===================================================================
    // ENDPOINT 16: Generic Method with Wildcard AND Type Parameter
    // Combines both patterns
    // ===================================================================
    @PostMapping("/combined-wildcard-generic")
    public <@TypeAnno("CombinedWildcard") T> ResponseEntity<List<? extends T>> 
            combinedWildcardGeneric(
                    @RequestBody T seed,
                    @RequestParam int count) {
        List<T> result = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            result.add(seed);
        }
        return ResponseEntity.ok(result);
    }

    // ===================================================================
    // ENDPOINT 17: Shadowing - Method Type Parameter Shadows Class Type
    // The controller has <T>, this method ALSO has <T> (different T!)
    // ===================================================================
    @PostMapping("/shadow-test")
    public <@TypeAnno("ShadowedT") T> ResponseEntity<T> shadowTest(
            @RequestBody T localT) {
        // This 'T' is NOT the same as the class-level 'T'
        return ResponseEntity.ok(localT);
    }

    // ===================================================================
    // ENDPOINT 18: Multiple Shadowed Parameters
    // ===================================================================
    @PostMapping("/multi-shadow")
    public <
        @TypeAnno("Shadow1") T,
        @TypeAnno("Shadow2") U,
        @TypeAnno("Shadow3") V
    > ResponseEntity<Triple<T, U, V>> multiShadow(
            @RequestBody T first,
            @RequestParam U second,
            @RequestHeader("X-Third") V third) {
        return ResponseEntity.ok(new Triple<>(first, second, third));
    }

    // ===================================================================
    // ENDPOINT 19: Varargs with Generics
    // ===================================================================
    @SafeVarargs
    @PostMapping("/varargs-generic")
    public final <@TypeAnno("Varargs") E> ResponseEntity<List<E>> varargsGeneric(
            @RequestBody E first,
            @RequestParam E... rest) {
        List<E> result = new ArrayList<>();
        result.add(first);
        result.addAll(Arrays.asList(rest));
        return ResponseEntity.ok(result);
    }

    // ===================================================================
    // ENDPOINT 20: Complex Nested Generics in Parameters
    // ===================================================================
    @PostMapping("/complex-nested")
    public <
        @TypeAnno("OuterKey") K,
        @TypeAnno("InnerValue") V
    > ResponseEntity<Map<K, List<Map<String, V>>>> complexNested(
            @RequestBody Map<K, List<Map<String, V>>> complexData) {
        return ResponseEntity.ok(complexData);
    }

    // ===================================================================
    // ENDPOINT 21: Functional Interface Parameters with Generics
    // ===================================================================
    @PostMapping("/functional-params")
    public <
        @TypeAnno("Input") I,
        @TypeAnno("Output") O
    > ResponseEntity<List<O>> functionalParams(
            @RequestBody List<I> inputs,
            @RequestParam Function<I, O> transformer) {
        List<O> outputs = new ArrayList<>();
        for (I input : inputs) {
            outputs.add(transformer.apply(input));
        }
        return ResponseEntity.ok(outputs);
    }

    // ===================================================================
    // ENDPOINT 22: Callable/Supplier with Generic Return
    // ===================================================================
    @PostMapping("/callable-supplier")
    public <@TypeAnno("Result") R> ResponseEntity<R> callableSupplier(
            @RequestBody Supplier<R> supplier,
            @RequestParam(defaultValue = "false") boolean useCallable) throws Exception {
        R result = supplier.get();
        return ResponseEntity.ok(result);
    }

    // ===================================================================
    // ENDPOINT 23: BiFunction with Three Type Parameters
    // ===================================================================
    @PostMapping("/bi-function")
    public <
        @TypeAnno("First") F,
        @TypeAnno("Second") S,
        @TypeAnno("Result") R
    > ResponseEntity<R> biFunction(
            @RequestBody F first,
            @RequestParam S second,
            @RequestHeader("X-Combiner") BiFunction<F, S, R> combiner) {
        return ResponseEntity.ok(combiner.apply(first, second));
    }

    // ===================================================================
    // ENDPOINT 24: Predicate with Generic Test
    // ===================================================================
    @PostMapping("/predicate-filter")
    public <@TypeAnno("Element") E> ResponseEntity<List<E>> predicateFilter(
            @RequestBody List<E> elements,
            @RequestParam Predicate<E> filter) {
        List<E> filtered = new ArrayList<>();
        for (E element : elements) {
            if (filter.test(element)) {
                filtered.add(element);
            }
        }
        return ResponseEntity.ok(filtered);
    }

    // ===================================================================
    // ENDPOINT 25: Consumer with Side Effects
    // ===================================================================
    @PostMapping("/consumer-action")
    public <@TypeAnno("Item") I> ResponseEntity<Void> consumerAction(
            @RequestBody List<I> items,
            @RequestParam Consumer<I> action) {
        items.forEach(action);
        return ResponseEntity.status(HttpStatus.NO_CONTENT).build();
    }

    // ===================================================================
    // ENDPOINT 26: Recursive with Wildcard - Ultra Complex
    // ===================================================================
    @PostMapping("/recursive-wildcard")
    public <@TypeAnno("RecursiveWild") RW extends Comparable<? super RW>> 
            ResponseEntity<RW> recursiveWildcard(
                    @RequestBody RW value,
                    @RequestParam List<? extends RW> candidates) {
        RW max = value;
        for (RW candidate : candidates) {
            if (candidate.compareTo(max) > 0) {
                max = candidate;
            }
        }
        return ResponseEntity.ok(max);
    }

    // ===================================================================
    // ENDPOINT 27: Self-Referential with Builder Pattern
    // ===================================================================
    @PostMapping("/self-referential-builder")
    public <@TypeAnno("Builder") B extends Builder<B>> ResponseEntity<B> selfReferentialBuilder(
            @RequestBody B builder,
            @RequestParam String configValue) {
        builder.configure(configValue);
        return ResponseEntity.ok(builder);
    }

    // ===================================================================
    // ENDPOINT 28: Enum Type Parameter
    // ===================================================================
    @PostMapping("/enum-type")
    public <@TypeAnno("EnumType") E extends Enum<E>> ResponseEntity<E> enumType(
            @RequestBody E enumValue) {
        return ResponseEntity.ok(enumValue);
    }

    // ===================================================================
    // ENDPOINT 29: Array Parameter with Generics
    // ===================================================================
    @PostMapping("/array-generic")
    public <@TypeAnno("ArrayElement") A> ResponseEntity<List<A>> arrayGeneric(
            @RequestBody A[] array) {
        return ResponseEntity.ok(Arrays.asList(array));
    }

    // ===================================================================
    // ENDPOINT 30: Multiple Complex Bounds Combined
    // ===================================================================
    @PostMapping("/mega-complex")
    public <
        @TypeAnno("MegaComplex") 
        MC extends @TypeAnno("BoundLevel1") Number 
              & Comparable<MC> 
              & @TypeAnno("BoundLevel2") Serializable
              & Cloneable
    > ResponseEntity<MC> megaComplex(
            @RequestBody MC value,
            @RequestParam(defaultValue = "process") String action,
            @RequestHeader(value = "X-Metadata", required = false) String metadata) {
        return ResponseEntity.ok(value);
    }

    // ===================================================================
    // JAVA 17+ FEATURES: Records with Generics
    // ===================================================================
    
    public record Container<S, N>(S string, N number) {
        public <@TypeAnno("RecordMethod") R> R transform(Function<S, R> mapper) {
            return mapper.apply(string);
        }
    }

    public record Pair<A, B>(A first, B second) {
        public static <X, Y> Pair<X, Y> of(X x, Y y) {
            return new Pair<>(x, y);
        }
    }

    public record Triple<T, U, V>(T first, U second, V third) {
        public <@TypeAnno("TripleMap") R> Triple<R, U, V> mapFirst(Function<T, R> mapper) {
            return new Triple<>(mapper.apply(first), second, third);
        }
    }

    // ===================================================================
    // JAVA 17+ FEATURES: Sealed Interfaces with Generics
    // ===================================================================
    
    public sealed interface Result<@TypeAnno("ResultType") T> 
            permits Success, Failure {
        T getValue();
        boolean isSuccess();
    }

    public record Success<T>(T value) implements Result<T> {
        @Override
        public T getValue() { return value; }
        
        @Override
        public boolean isSuccess() { return true; }
    }

    public record Failure<T>(T defaultValue, String error) implements Result<T> {
        @Override
        public T getValue() { return defaultValue; }
        
        @Override
        public boolean isSuccess() { return false; }
    }

    // ===================================================================
    // ENDPOINT 31: Sealed Type Result Pattern
    // ===================================================================
    @PostMapping("/sealed-result")
    public <@TypeAnno("SealedResult") SR> ResponseEntity<Result<SR>> sealedResult(
            @RequestBody SR value,
            @RequestParam(defaultValue = "false") boolean fail) {
        if (fail) {
            return ResponseEntity.ok(new Failure<>(value, "Simulated failure"));
        }
        return ResponseEntity.ok(new Success<>(value));
    }

    // ===================================================================
    // Nested Class with Shadowing
    // ===================================================================
    
    public class InnerShadow<@TypeAnno("InnerOuter") T> {
        
        @PostMapping("/inner-shadow")
        public <@TypeAnno("InnerMethod") T> ResponseEntity<T> innerMethod(
                @RequestBody T item) {
            // This T shadows both the outer class T AND the InnerShadow T
            return ResponseEntity.ok(item);
        }

        @PostMapping("/inner-mixed")
        public <U extends T> ResponseEntity<U> innerMixed(
                @RequestBody U specific,
                @RequestParam T general) {
            // U extends the InnerShadow's T (not the outer class T)
            return ResponseEntity.ok(specific);
        }
    }

    // ===================================================================
    // Static Method - CANNOT use class-level T
    // Must define its own type parameters
    // ===================================================================
    
    @GetMapping("/static-generic")
    public static <@TypeAnno("StaticMethod") ST> ResponseEntity<ST> staticGeneric(
            @RequestParam ST input) {
        // This ST is completely independent from any class-level generics
        return ResponseEntity.ok(input);
    }

    // ===================================================================
    // Interface for Builder Pattern Testing
    // ===================================================================
    
    public interface Builder<B extends Builder<B>> {
        B configure(String value);
    }

    // ===================================================================
    // ENDPOINT 32: Class Type Parameter with Reflection
    // ===================================================================
    @PostMapping("/class-type")
    public <@TypeAnno("ClassType") CT> ResponseEntity<CT> classType(
            @RequestBody Class<CT> clazz,
            @RequestParam Map<String, Object> params) throws Exception {
        CT instance = clazz.getDeclaredConstructor().newInstance();
        return ResponseEntity.ok(instance);
    }

    // ===================================================================
    // ENDPOINT 33: Optional with Generics
    // ===================================================================
    @PostMapping("/optional-generic")
    public <@TypeAnno("Optional") OT> ResponseEntity<OT> optionalGeneric(
            @RequestBody Optional<OT> optionalValue,
            @RequestParam OT defaultValue) {
        return ResponseEntity.ok(optionalValue.orElse(defaultValue));
    }

    // ===================================================================
    // ENDPOINT 34: Stream Operations with Generics
    // ===================================================================
    @PostMapping("/stream-operations")
    public <
        @TypeAnno("StreamInput") SI,
        @TypeAnno("StreamOutput") SO
    > ResponseEntity<List<SO>> streamOperations(
            @RequestBody List<SI> inputs,
            @RequestParam Function<SI, SO> mapper,
            @RequestHeader(value = "X-Filter", required = false) Predicate<SO> filter) {
        var stream = inputs.stream().map(mapper);
        if (filter != null) {
            stream = stream.filter(filter);
        }
        return ResponseEntity.ok(stream.toList());
    }

    // ===================================================================
    // ENDPOINT 35: Collector with Complex Generics
    // ===================================================================
    @PostMapping("/collector-complex")
    public <
        @TypeAnno("Source") S,
        @TypeAnno("Target") TG
    > ResponseEntity<Map<TG, List<S>>> collectorComplex(
            @RequestBody List<S> sources,
            @RequestParam Function<S, TG> classifier) {
        Map<TG, List<S>> grouped = new HashMap<>();
        for (S source : sources) {
            TG key = classifier.apply(source);
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(source);
        }
        return ResponseEntity.ok(grouped);
    }
}

// =============================================================================
// ANNOTATION DEFINITIONS
// Identical to GenericsTortureTest for consistency
// =============================================================================

@Target({ElementType.TYPE_PARAMETER, ElementType.TYPE_USE})
@interface TypeAnno {
    String value();
}

@Target(ElementType.TYPE_PARAMETER)
@interface Validated {
    Class<?> validator();
    Class<?> groups() default Object.class;
    String message() default "";
}

@Target(ElementType.TYPE_PARAMETER)
@interface MultiValidator {
    Class<?>[] validators();
}

@Target(ElementType.TYPE_PARAMETER)
@interface Wrapper {
    TypeAnno inner();
}

@Target(ElementType.TYPE_PARAMETER)
@interface RetentionTest {
    RetentionPolicy policy();
}

// =============================================================================
// VALIDATOR CLASSES (Dummy implementations for CLASS_REFERENCE testing)
// =============================================================================

class StringValidator {}
class NumberValidator {}
class ValidationGroup {}
class QuickValidator {}
class FullValidator {}
class DetailedValidator {}
class CustomValidator {}
class MethodValidator {}
