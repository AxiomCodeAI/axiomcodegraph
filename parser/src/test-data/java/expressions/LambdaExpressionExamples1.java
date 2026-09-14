package com.inventory.auth.examples19;

import java.util.function.*;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.Comparator;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

import javafx.scene.effect.Light.Point;

/**
 * Comprehensive Lambda Expression Test Cases
 * Tests various lambda forms and their expression body extraction.
 */
public class LambdaExpressionExamples {

    // =========================================================================
    // BASIC LAMBDA FORMS
    // =========================================================================

    // Single parameter without parentheses - expression body
    Function<Integer, Integer> doubler = x -> x * 2;

    // Single parameter with parentheses - expression body
    Function<String, Integer> lengthFn = (s) -> s.length();

    // Multiple parameters - expression body
    BiFunction<Integer, Integer, Integer> adder = (a, b) -> a + b;

    // No parameters - expression body
    Supplier<String> greeter = () -> "Hello, World!";

    // Single parameter with explicit type
    Function<String, String> upperCase = (String s) -> s.toUpperCase();

    // Multiple parameters with explicit types
    BiFunction<String, Integer, String> repeater = (String s, Integer n) -> s.repeat(n);

    // =========================================================================
    // COMPLEX EXPRESSION BODIES
    // =========================================================================

    // Ternary expression in lambda body
    Function<Integer, String> signChecker = x -> x >= 0 ? "positive" : "negative";

    // Method invocation chain in lambda body
    Function<String, String> trimAndUpper = s -> s.trim().toUpperCase();

    // Binary expression with multiple operators
    BiFunction<Integer, Integer, Integer> complexMath = (a, b) -> a * b + a - b;

    // Instanceof in lambda body
    Function<Object, Boolean> isString = obj -> obj instanceof String;

    // Cast expression in lambda body
    Function<Object, String> castToString = obj -> (String) obj;

    // Array access in lambda body
    Function<int[], Integer> firstElement = arr -> arr[0];

    // Field access in lambda body
    Function<Person, String> getName = p -> p.name;

    // Object creation in lambda body
    Supplier<List<String>> listCreator = () -> new ArrayList<>();

    // Generic object creation
    Supplier<Map<String, Integer>> mapCreator = () -> new java.util.HashMap<>();

    // =========================================================================
    // NESTED LAMBDAS (Lambda returning Lambda)
    // =========================================================================

    // Curried function - lambda returning lambda
    Function<Integer, Function<Integer, Integer>> curriedAdd = x -> y -> x + y;

    // Triple nested lambda
    Function<Integer, Function<Integer, Function<Integer, Integer>>> tripleNested = 
        x -> y -> z -> x + y + z;

    // Lambda returning lambda with method invocation
    Function<String, Function<String, String>> concatCurried = 
        prefix -> suffix -> prefix.concat(suffix);

    // =========================================================================
    // LAMBDAS WITH COMPLEX TYPES
    // =========================================================================

    // Comparator lambda
    Comparator<String> lengthComparator = (s1, s2) -> s1.length() - s2.length();

    // BiPredicate
    BiPredicate<String, String> containsCheck = (str, sub) -> str.contains(sub);

    // Consumer
    Consumer<String> printer = s -> System.out.println(s);

    // BiConsumer
    BiConsumer<String, Integer> repeatedPrint = (s, n) -> System.out.println(s.repeat(n));

    // Predicate with complex condition
    Predicate<String> complexPredicate = s -> s != null && s.length() > 5 && s.startsWith("A");

    // =========================================================================
    // LAMBDAS WITH GENERICS
    // =========================================================================

    // Generic identity function
    Function<Object, Object> identity = x -> x;

    // Lambda with wildcard types
    Function<List<?>, Integer> listSize = list -> list.size();

    // Lambda with bounded wildcard
    Function<List<? extends Number>, Double> sumNumbers = 
        list -> list.stream().mapToDouble(Number::doubleValue).sum();

    // =========================================================================
    // LAMBDAS IN COMPLEX EXPRESSIONS
    // =========================================================================

    // Lambda as method argument (simulated with field)
    List<String> names = List.of("Alice", "Bob", "Charlie");
    
    // Lambda in ternary expression
    Function<Integer, Integer> conditional = true ? x -> x * 2 : x -> x * 3;

    // Lambda with string template in body (Java 21+)
    Function<String, String> withTemplate = name -> STR."Hello, \{name}!";

    // =========================================================================
    // LAMBDAS WITH RECORD PATTERNS (Java 21+)
    // =========================================================================

    record Point(int x, int y) {}
    record Person(String name, int age) {}

    // Lambda with instanceof pattern in body
    Function<Object, String> patternLambda = 
        obj -> obj instanceof Point(int x, int y) ? STR."Point(\{x}, \{y})" : "not a point";

    // Lambda with switch expression in body
    Function<Object, String> switchLambda = obj -> switch (obj) {
        case Integer i -> STR."Integer: \{i}";
        case String s -> STR."String: \{s}";
        case Point(int x, int y) -> STR."Point: \{x}, \{y}";
        default -> "unknown";
    };

    // =========================================================================
    // LAMBDAS WITH METHOD REFERENCES COMPARISON
    // =========================================================================

    // Lambda equivalent of method reference
    Function<String, Integer> lambdaLength = s -> s.length();
    Function<String, Integer> methodRefLength = String::length;

    // Lambda equivalent of constructor reference
    Supplier<ArrayList<String>> lambdaConstructor = () -> new ArrayList<>();
    Supplier<ArrayList<String>> constructorRef = ArrayList::new;

    // =========================================================================
    // VARARGS AND SPECIAL PARAMETERS
    // =========================================================================

    // Lambda with array parameter
    Function<String[], String> joinArray = arr -> String.join(",", arr);

    // Lambda with varargs (through interface)
    @FunctionalInterface
    interface VarargFunction {
        String apply(String... args);
    }
    VarargFunction varargLambda = args -> String.join("-", args);

    // =========================================================================
    // LAMBDAS WITH EXCEPTION HANDLING (expression form)
    // =========================================================================

    // Lambda with ternary for null-safe parsing (expression body)
    Function<String, Integer> parseIntSafe = s -> s != null ? Integer.parseInt(s) : 0;

    // Note: Block lambdas (with { }) won't have body extracted yet (future: method body extraction)
    // Example of block lambda (body not extracted):
    // Function<String, Integer> blockLambda = s -> { return s.length(); };

    // =========================================================================
    // BINARY/UNARY OPERATIONS IN LAMBDA BODIES
    // =========================================================================

    // Unary operations
    Function<Integer, Integer> negate = x -> -x;
    Function<Boolean, Boolean> notFn = b -> !b;
    Function<Integer, Integer> increment = x -> ++x;

    // Logical operations
    BiPredicate<Boolean, Boolean> andFn = (a, b) -> a && b;
    BiPredicate<Boolean, Boolean> orFn = (a, b) -> a || b;

    // Bitwise operations
    BiFunction<Integer, Integer, Integer> bitwiseAnd = (a, b) -> a & b;
    BiFunction<Integer, Integer, Integer> bitwiseOr = (a, b) -> a | b;
    BiFunction<Integer, Integer, Integer> bitwiseXor = (a, b) -> a ^ b;
    Function<Integer, Integer> bitwiseNot = x -> ~x;
    BiFunction<Integer, Integer, Integer> leftShift = (a, b) -> a << b;
    BiFunction<Integer, Integer, Integer> rightShift = (a, b) -> a >> b;

    // =========================================================================
    // OPTIONAL AND STREAM LAMBDAS
    // =========================================================================

    // Lambda for Optional operations
    Function<Optional<String>, String> orElseLambda = opt -> opt.orElse("default");

    // Lambda for stream operations (as field values)
    Function<List<Integer>, List<Integer>> filterPositive = 
        list -> list.stream().filter(x -> x > 0).collect(Collectors.toList());

    // Nested lambda in stream
    Function<List<String>, List<String>> transformList = 
        list -> list.stream().map(s -> s.toUpperCase()).collect(Collectors.toList());

    // =========================================================================
    // LAMBDA CAPTURING OUTER SCOPE (effectively final)
    // =========================================================================

    private final int multiplier = 10;
    private final String prefix = "Result: ";

    // Lambda capturing field
    Function<Integer, Integer> captureField = x -> x * multiplier;

    // Lambda capturing multiple fields
    Function<Integer, String> captureMultiple = x -> prefix + (x * multiplier);

    // =========================================================================
    // PARENTHESIZED LAMBDA
    // =========================================================================

    // Lambda in parentheses
    Function<Integer, Integer> parenthesized = ((Function<Integer, Integer>) (x -> x * 2));

    // Chained lambda application
    Integer result = ((Function<Integer, Integer>) (x -> x + 1)).apply(5);

    // =========================================================================
    // STREAMING API LAMBDAS - Field Initializers with Stream Operations
    // =========================================================================

    // Stream.map with lambda
    List<Integer> lengths = List.of("a", "bb", "ccc").stream()
        .map(s -> s.length())
        .collect(Collectors.toList());

    // Stream.filter with lambda
    List<String> filtered = List.of("apple", "banana", "cherry").stream()
        .filter(s -> s.startsWith("a"))
        .collect(Collectors.toList());

    // Stream.forEach (returns void, assigned to Object for field)
    Runnable forEachRunner = () -> List.of(1, 2, 3).forEach(n -> System.out.println(n));

    // Stream.reduce with lambda
    Integer sum = List.of(1, 2, 3, 4, 5).stream()
        .reduce(0, (a, b) -> a + b);

    // Stream.sorted with Comparator lambda
    List<String> sorted = List.of("banana", "apple", "cherry").stream()
        .sorted((a, b) -> a.compareTo(b))
        .collect(Collectors.toList());

    // Stream.flatMap with lambda
    List<Integer> flatMapped = List.of(List.of(1, 2), List.of(3, 4)).stream()
        .flatMap(list 
            -> list.stream())
        .collect(Collectors.toList());

    // Stream.anyMatch/allMatch/noneMatch with lambda
    Boolean hasLong = List.of("a", "bb", "ccc").stream()
        .anyMatch(s -> s.length() > 2);

    Boolean allShort = List.of("a", "bb", "ccc").stream()
        .allMatch(s -> s.length() < 10);

    Boolean noneEmpty = List.of("a", "bb", "ccc").stream()
        .noneMatch(s -> s.isEmpty());

    // Stream.findFirst with filter lambda
    Optional<String> firstLong = List.of("a", "bb", "ccc").stream()
        .filter(s 
            -> s.length() > 1)
        .findFirst();

    // Stream.count after filter
    Long countLong = List.of("a", "bb", "ccc").stream()
        .filter(s -> s.length() > 1)
        .count();

    // Stream.mapToInt/mapToDouble with lambda
    int sumLengths = List.of("a", "bb", "ccc").stream()
        .mapToInt(s -> s.length())
        .sum();

    // Stream.max/min with Comparator lambda
    Optional<String> longest = List.of("a", "bb", "ccc").stream()
        .max((a, b) -> a.length() - b.length());

    // Chained stream operations with multiple lambdas
    List<String> chainedStream = List.of("  apple  ", "  BANANA  ", "  cherry  ").stream()
        .map(s -> s.trim())
        .filter(s -> s.length() > 4)
        .map(s -> s.toLowerCase())
        .sorted((a, b) -> a.compareTo(b))
        .collect(Collectors.toList());

    // Stream.peek with lambda (for debugging)
    List<String> peeked = List.of("a", "b", "c").stream()
        .peek(s -> System.out.println(s))
        .map(s -> s.toUpperCase())
        .collect(Collectors.toList());

    List<String> peeked2 = List.of("a", "b", "c").stream()
        .peek(System.out::println)
        .map(s -> s.toUpperCase())
        .collect(Collectors.toList());
    // Stream.distinct then map
    List<Integer> distinctLengths = List.of("a", "bb", "a", "ccc", "bb").stream()
        .distinct()
        .map(s -> s.length())
        .collect(Collectors.toList());

    // Stream.limit/skip with lambdas
    List<String> limited = List.of("a", "b", "c", "d", "e").stream()
        .filter(s -> !s.equals("c"))
        .limit(3)
        .collect(Collectors.toList());

    // Stream.takeWhile/dropWhile (Java 9+)
    List<Integer> takenWhile = List.of(1, 2, 3, 4, 5).stream()
        .takeWhile(n -> n < 4)
        .collect(Collectors.toList());

    // Collectors.groupingBy with lambda
    Map<Integer, List<String>> groupedByLength = List.of("a", "bb", "ccc", "dd").stream()
        .collect(Collectors.groupingBy(s -> s.length()));

    // Collectors.partitioningBy with lambda
    Map<Boolean, List<String>> partitioned = List.of("a", "bb", "ccc").stream()
        .collect(Collectors.partitioningBy(s -> s.length() > 1));

    // Collectors.toMap with lambdas
    Map<String, Integer> toMap = List.of("a", "bb", "ccc").stream()
        .collect(Collectors.toMap(s -> s, s -> s.length()));

    // Collectors.joining with map lambda
    String joined = List.of("a", "b", "c").stream()
        .map(s -> s.toUpperCase())
        .collect(Collectors.joining(", "));

    // =========================================================================
    // ANONYMOUS CLASS WITH LAMBDAS IN FIELD INITIALIZERS
    // =========================================================================

    // Anonymous Runnable with lambda in field
    Runnable anonRunnable = new Runnable() {
        Function<Integer, Integer> innerLambda = x -> x * 2;
        @Override
        public void run() {}
    };

    // Anonymous Comparator with lambda field
    Comparator<String> anonComparator = new Comparator<String>() {
        Function<String, Integer> lengthFn = s -> s.length();
        @Override
        public int compare(String a, String b) { return 0; }
    };

    // Anonymous class with multiple lambda fields
    Object anonMultiLambda = new Object() {
        Function<Integer, Integer> double_ = x -> x * 2;
        Function<Integer, Integer> triple = x -> x * 3;
        BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
        Predicate<String> notEmpty = s -> !s.isEmpty();
    };

    // Anonymous class extending abstract class with lambda
    abstract class Processor {
        abstract void process();
    }
    Processor anonProcessor = new Processor() {
        Consumer<String> handler = s -> System.out.println(s);
        @Override
        void process() {}
    };

    // Anonymous class with nested lambda (lambda in lambda field)
    Object nestedLambdaAnon = new Object() {
        Function<Integer, Function<Integer, Integer>> curried = x -> y -> x + y;
    };

    // Anonymous class with stream lambda in field
    Object streamAnonClass = new Object() {
        List<Integer> processed = List.of(1, 2, 3).stream()
            .map(n -> n * 2)
            .filter(n -> n > 2)
            .collect(Collectors.toList());
    };

    // =========================================================================
    // LAMBDA IN COMPLEX FIELD EXPRESSIONS
    // =========================================================================

    // Lambda as argument to method in field initializer
    List<String> sortedWithLambda = new ArrayList<>(List.of("b", "a", "c")) {{
        sort((a, b) -> a.compareTo(b));
    }};

    // Optional.map with lambda
    Optional<Integer> optMapped = Optional.of("hello").map(s -> s.length());

    // Optional.filter with lambda
    Optional<String> optFiltered = Optional.of("hello").filter(s -> s.length() > 3);

    // Optional.flatMap with lambda
    Optional<Integer> optFlatMapped = Optional.of("hello")
        .flatMap(s -> Optional.of(s.length()));

    // Optional.orElseGet with lambda supplier
    String orElseResult = Optional.<String>empty().orElseGet(() -> "default");

    // Optional.ifPresent captured (won't return value, but shows lambda usage)
    Runnable ifPresentRunner = () -> Optional.of("hello").ifPresent(s -> System.out.println(s));

    // =========================================================================
    // LAMBDA WITH GENERIC BOUNDS
    // =========================================================================

    // Lambda with extends bound
    Function<List<? extends Number>, Double> sumExtends = 
        list -> list.stream().mapToDouble(Number::doubleValue).sum();

    // Lambda with super bound
    Consumer<? super String> superConsumer = s -> System.out.println(s);

    // =========================================================================
    // LAMBDA IN ARRAY INITIALIZATION
    // =========================================================================

    // Array of lambdas
    @SuppressWarnings("unchecked")
    Function<Integer, Integer>[] lambdaArray = new Function[] {
        x -> x * 1,
        x -> x * 2,
        x -> x * 3
    };

    // Array with mixed lambdas
    Runnable[] runnables = new Runnable[] {
        () -> System.out.println("first"),
        () -> System.out.println("second"),
        () -> System.out.println("third")
    };

    // =========================================================================
    // LAMBDA WITH THIS/SUPER REFERENCES
    // =========================================================================

    private String instanceField = "instance";

    // Lambda referencing this
    Supplier<String> thisReference = () -> this.instanceField;

    // Lambda referencing this.method (simulated)
    Supplier<Integer> thisMethod = () -> this.hashCode();

    // =========================================================================
    // COMPLEX NESTED STREAM LAMBDAS
    // =========================================================================

    // Nested stream with multiple lambdas
    List<List<Integer>> nestedList = List.of(List.of(1, 2), List.of(3, 4));
    List<Integer> flattenedDoubled = nestedList.stream()
        .flatMap(inner -> inner.stream().map(n -> n * 2))
        .filter(n -> n > 2)
        .collect(Collectors.toList());

    // Stream with ternary in lambda
    List<String> ternaryStream = List.of(1, 2, 3, 4, 5).stream()
        .map(n -> n % 2 == 0 ? "even" : "odd")
        .collect(Collectors.toList());

    // Stream with method chain in lambda
    List<String> methodChainStream = List.of("  hello  ", "  world  ").stream()
        .map(s -> s.trim().toUpperCase().concat("!"))
        .collect(Collectors.toList());

    // Stream with instanceof in lambda
    List<Object> mixedList = List.of("string", 123, "another", 456);
    List<String> stringsOnly = mixedList.stream()
        .filter(obj -> obj instanceof String)
        .map(obj -> (String) obj)
        .collect(Collectors.toList());

    // Stream with record pattern in lambda (Java 21+)
    List<Object> points = List.of(new Point(1, 2), new Point(3, 4), "not a point");
    List<String> pointStrings = points.stream()
        .filter(obj -> obj instanceof Point)
        .map(obj -> obj instanceof Point(int x, int y) ? x + "," + y : "")
        .collect(Collectors.toList());

    // ==================== ASSIGNMENT IN LAMBDA BODY ====================

    int[] holder = {0};

    // Assignment expression as lambda body (side effect)
    Consumer<Integer> assignInBody = x -> holder[0] = x;

    // Compound assignment in lambda body
    Consumer<Integer> compoundAssign = x -> holder[0] += x;
    Consumer<Integer> compoundMul = x -> holder[0] *= x;

    // Chained assignment
    Consumer<Integer> chainedAssign = x -> holder[0] = holder[1] = x;

    // ==================== VAR PARAMETER TYPE (Java 11+) ====================

    // Lambda with var and annotations
    BiFunction<String, String, String> varParams = (var a, var b) -> a + b;

    // Lambda with nested generic types - single param with List<String>
    Function<List<String>, Integer> nestedGeneric1 = (List<String> items) -> items.size();

    // Lambda with nested generic types - Map<String, Integer>
    Function<Map<String, Integer>, Integer> nestedGeneric2 = (Map<String, Integer> map) -> map.size();

    // Lambda with deeply nested generics - List<Map<String, List<Integer>>>
    Function<List<Map<String, List<Integer>>>, Integer> deeplyNested = 
        (List<Map<String, List<Integer>>> data) -> data.size();

    // Lambda with multiple nested generic params at different positions
    BiFunction<List<String>, Map<Integer, String>, Integer> multiNestedParams = 
        (List<String> first, Map<Integer, String> second) -> first.size() + second.size();

    // Lambda with triple-nested generic - Optional<List<Set<String>>>
    Function<Optional<List<Set<String>>>, Boolean> tripleNestedLambdaParam = 
        (Optional<List<Set<String>>> opt) -> opt.isPresent();

    // Lambda with wildcard bounds - List<? extends Number>
    Function<List<? extends Number>, Double> wildcardExtends = 
        (List<? extends Number> nums) -> nums.stream().mapToDouble(Number::doubleValue).sum();

    // Lambda with wildcard super - List<? super Integer>
    Consumer<List<? super Integer>> wildcardSuper = (List<? super Integer> list) -> list.add(42);

    // Lambda with array of generics - List<String>[]
    Function<List<String>[], Integer> arrayOfGenerics = (List<String>[] arr) -> arr.length;

    // Lambda with BiFunction using nested generics in both params
    BiFunction<Map<String, List<Integer>>, List<Map<Integer, String>>, Integer> complexBiFunc = 
        (Map<String, List<Integer>> first, List<Map<Integer, String>> second) -> first.size() + second.size();

    // var with annotation (if you have @Nullable etc.)
    // BiFunction<String, String, String> annotatedVar = (@Nullable var a, var b) -> a + b;

    // ==================== ANONYMOUS CLASS CREATION IN LAMBDA BODY ====================

    // Lambda returning anonymous class
    Supplier<Runnable> anonInLambda = () -> new Runnable() {
        @Override
        public void run() {
            System.out.println("anonymous in lambda");
        }
    };

    // Lambda returning anonymous class with fields
    Supplier<Comparator<String>> anonWithFields = () -> new Comparator<String>() {
        private int callCount = 0;
        @Override
        public int compare(String a, String b) {
            callCount++;
            return a.compareTo(b);
        }
    };

    // ==================== ARRAY CREATION IN LAMBDA BODY ====================

    // Primitive array creation
    Supplier<int[]> createIntArray = () -> new int[10];

    // Array creation with initializer
    Supplier<int[]> createInitArray = () -> new int[]{1, 2, 3};

    // Multi-dimensional array
    Supplier<int[][]> createMatrix = () -> new int[3][3];

    // Generic array (with warning)
    @SuppressWarnings("unchecked")
    Supplier<List<String>[]> createGenericArray = () -> new ArrayList[5];

    // ==================== CLASS LITERAL IN LAMBDA BODY ====================

    Supplier<Class<?>> classLiteral = () -> String.class;
    Supplier<Class<?>> primitiveClass = () -> int.class;
    Supplier<Class<?>> arrayClass = () -> String[].class;

    // ==================== LAMBDA AS METHOD RECEIVER ====================

    // Immediate invocation of lambda
    String immediateResult = ((Supplier<String>) () -> "immediate").get();

    // Chained method on lambda result
    int chainedOnLambda = ((Function<String, String>) s -> s.toUpperCase()).apply("test").length();

    // Lambda in method chain
    String lambdaChain = Optional.of("test")
        .map(((Function<String, String>) s -> s.toUpperCase()))
        .orElse("");

    // ==================== LAMBDA IN BOTH TERNARY BRANCHES ====================

    boolean flag = true;
    Function<Integer, Integer> ternaryLambdas = flag 
        ? (x -> x * 2) 
        : (x -> x * 3);

    // Complex ternary with different lambda forms
    Function<String, String> complexTernaryLambda = flag
        ? s -> s.toUpperCase()
        : s -> s.toLowerCase();

    // ==================== QUALIFIED THIS/SUPER IN LAMBDA ====================

    class OuterClass {
        String outerField = "outer";
        
        class InnerClass {
            String innerField = "inner";
            
            // Lambda with qualified this
            Supplier<String> qualifiedThis = () -> OuterClass.this.outerField;
            
            // Lambda accessing both
            Supplier<String> bothFields = () -> OuterClass.this.outerField + this.innerField;
        }
    }

    class ChildClass extends ParentClass {
        // Lambda calling super method
        Supplier<String> superInLambda = () -> super.parentMethod();
        
        // Lambda with super field access  
        Supplier<String> superFieldLambda = () -> super.parentField;
    }

    class ParentClass {
        String parentField = "parent";
        String parentMethod() { return "from parent"; }
    }

    // ==================== INTERSECTION TYPE CAST IN LAMBDA BODY ====================

    Function<Object, java.io.Serializable> intersectionLambda = 
        obj -> (java.io.Serializable & Comparable<?>) obj;

    // ==================== LAMBDA WITH INSTANCEOF PATTERN + GUARD ====================

    // Complex instanceof with && in lambda
    Predicate<Object> complexInstanceof = obj -> 
        obj instanceof String s && s.length() > 5 && s.startsWith("A");

    // Chained instanceof patterns
    BiPredicate<Object, Object> dualPattern = (a, b) ->
        a instanceof String sa && b instanceof String sb && sa.equals(sb);

    // ==================== NULL-RELATED LAMBDAS ====================

    // Null assignment to functional interface
    Function<String, String> nullLambda = null;

    // Lambda returning null
    Supplier<String> returnsNull = () -> null;

    // Lambda with null check in body
    Function<String, String> nullSafe = s -> s == null ? "" : s.toUpperCase();

    // ==================== EMPTY/MINIMAL LAMBDAS ====================

    // Lambda with just literal
    Supplier<Integer> justLiteral = () -> 42;
    Supplier<String> justString = () -> "constant";
    Supplier<Boolean> justBool = () -> true;

    // Lambda with just variable
    int capturedValue = 10;
    Supplier<Integer> justVariable = () -> capturedValue;

    // Lambda with just null
    Supplier<Object> justNull = () -> null;

    // ==================== LAMBDA WITH PRE/POST INCREMENT ON ARRAY ====================

    int[] counter = {0};
    Supplier<Integer> preIncArray = () -> ++counter[0];
    Supplier<Integer> postIncArray = () -> counter[0]++;

    // ==================== LAMBDA WITH SWITCH EXPRESSION (FULL FORMS) ====================

    // Switch with yield in lambda (block form in switch, expression lambda)
    Function<Integer, String> switchYield = n -> switch(n) {
        case 1 -> "one";
        case 2 -> {
            String result = "two";
            yield result;
        }
        default -> "other";
    };

    // Switch with pattern matching in lambda
    Function<Object, String> switchPattern = obj -> switch(obj) {
        case Integer i when i > 0 -> "positive int";
        case Integer i -> "non-positive int";
        case String s when s.isEmpty() -> "empty string";
        case String s -> "string: " + s;
        case null -> "null";
        default -> "unknown";
    };

    // ==================== LAMBDA IN MAP.COMPUTEIFABSENT ETC ====================

    Map<String, List<String>> computeMap = new java.util.HashMap<>();
    List<String> computed = computeMap.computeIfAbsent("key", k -> new ArrayList<>());

    // computeIfPresent
    Integer computedPresent = Map.of("a", 1).computeIfPresent("a", (k, v) -> v + 1);

    // merge with lambda
    Map<String, Integer> mergeMap = new java.util.HashMap<>();
    Integer merged = Map.of("a", 1).merge("a", 2, (Integer v1, Integer v2) -> v1 + v2);

    // replaceAll with lambda
    // map.replaceAll((k, v) -> v.toUpperCase());

    // ==================== LAMBDA WITH EXPLICIT ARRAY TYPE PARAMETER ====================

    // Array as parameter type
    Function<String[], String> arrayParam = (String[] arr) -> arr[0];

    // Varargs-like with explicit array
    Function<int[], Integer> intArrayParam = (int[] arr) -> arr.length;


    static class GenericTypeVars<T, R extends Number & Comparable<R>> {

        Function<T, T> id = t -> t;

        Function<List<T>, Integer> sizeOfTList = list -> list.size();

        Function<List<? extends T>, T> firstExtendsT = list -> list.get(0);

        Function<List<? super T>, Integer> sizeSuperT = list -> list.size();

        Function<T, R> mapper = t -> (R) Integer.valueOf(0); // compiles but risks unsafe cast
    }
    

    // ==================== DEEPLY NESTED EXPRESSION IN LAMBDA ====================

    // Very deep nesting
    Function<String, Integer> deepNest = s -> 
        Integer.parseInt(String.valueOf(Math.abs(Integer.parseInt(s.trim()))));

    // Multiple ternary nesting
    Function<Integer, String> multiTernary = n ->
        n > 100 ? "large" : n > 50 ? "medium" : n > 10 ? "small" : "tiny";

    // ==================== LAMBDA WITH BITWISE ON BOOLEAN ====================

    BiPredicate<Boolean, Boolean> boolBitwiseAnd = (a, b) -> a & b;  // non-short-circuit
    BiPredicate<Boolean, Boolean> boolBitwiseOr = (a, b) -> a | b;   // non-short-circuit
    BiPredicate<Boolean, Boolean> boolBitwiseXor = (a, b) -> a ^ b;

    // ==================== LAMBDA PARAMETER SHADOWING ====================

    String shadowedField = "field";

    // Lambda parameter shadows field (valid)
    Function<String, String> shadowingLambda = shadowedField -> shadowedField.toUpperCase();

    // Nested lambda with shadowing
    Function<String, Function<String, String>> nestedShadow = 
        x -> (x2 -> x + x2);  // Note: can't reuse 'x' in nested lambda
}
