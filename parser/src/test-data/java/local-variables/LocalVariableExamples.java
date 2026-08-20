package com.inventory.auth.examples23;

import java.io.*;
import java.util.*;
import java.util.Collections;
import java.util.function.*;
import java.util.stream.*;

import org.checkerframework.checker.units.qual.h;

/**
 * Comprehensive test cases for local variable extraction.
 * Covers all contexts where local variables can be declared and all assignment types.
 */
public class LocalVariableExamples<T> {

    private final String someString = "hello";
    private final Function<String, String> blockLambdaField = s -> {
            String upper = s.toUpperCase();
            String trimmed = upper.trim();
            return new Object().toString();
        };

    private final int statusCodeFinalCheck = switch (status) {
        case ACTIVE: 1;
        case INACTIVE: 0;
        case PENDING: {
            int code = -1;
            yield code;
        }
    };


    private static final String instanceofResult = switch (mixedObj) {
            case String s -> {
                String upper = s.toUpperCase();
                int len = s.length();
                yield len + upper.length();
            }
            case Integer i when i > 0 -> {
                int doubled = i * 2;
                yield "Positive integer: " + doubled;
            }
            case Integer i -> {
                int negated = -i;
                yield negated;
            }
            case List<?> list -> {
                int size = list.size();
                boolean empty = list.isEmpty();
                yield "List with " + size + " elements";
            }
            case Map<?, ?> map -> {
                int mapSize = map.size();
                boolean hasKeys = !map.isEmpty();
                yield "Map with " + mapSize + " entries";
            }
            case Point p -> {
                int px = p.x();
                int py = p.y();
                yield "Point at " + px + "," + py;
            }
            case Person person when person.age() > 18 -> {
                String adultName = person.name();
                yield "Adult: " + adultName;
            }
            case Person person -> {
                String minorName = person.name();
                int minorAge = person.age();
                yield "Minor: " + minorName + " age " + minorAge;
            }
            case T something -> {
                yield "Something: " + something;
            }
            case int[] arr -> {
                int arrLen = arr.length;
                yield "Int array of length " + arrLen;
            }
            case List<Integer[]>[] ls -> {
                int lsLen = ls.length;
                yield "List of arrays with length " + lsLen;
            }
            case null -> "null value";
            default -> {
                String defaultType = mixedObj.getClass().getSimpleName();
                yield defaultType;
            }
        };
    // ========================================================================
    // CUSTOM TYPES FOR TESTING TYPE RESOLUTION
    // ========================================================================
    
    public record Point(int x, int y) {}
    public record Person(String name, int age) {}
    public record Box<T>(T value) {}
    
    public static class CustomService {
        public CustomService(String input) {}
        public String process(String input) { return input.toUpperCase(); }
        public static CustomService getInstance() { return new CustomService("Hello Testing"); }
    }
    
    public interface Processor<T, R> {
        R process(T input);
    }
    
    public enum Status { ACTIVE, INACTIVE, PENDING }
    
    // ========================================================================
    // SECTION 1: METHOD BODY - BASIC DECLARATIONS
    // ========================================================================
    
    public void basicDeclarations() {
        // Primitive literals
        int intVar = 42;
        long longVar = 100L;
        double doubleVar = 3.14;
        float floatVar = 2.5f;
        boolean boolVar = true;
        char charVar = 'A';
        byte byteVar = 127;
        short shortVar = 1000;
        
        // String and null
        String stringVar = "hello";
        String nullVar = null;
        
        // Uninitialized (declaration only)
        int uninitializedInt;
        String uninitializedString;
        
        // Multiple declarations in one statement
        int a = 1, b = 2, c = 3;
        String s1 = "one", s2 = "two", s3;
        uninitializedInt = 20;
        // Final local variables
        final int finalInt = 100;
        final String finalString = "constant";
        
        // Var inference (Java 10+)
        var inferredInt = 42;
        var inferredString = "inferred";
        var inferredList = new ArrayList<String>();
    }

    public int someReturnNumber(int a, int... b) {
        int x = 10;
        return a + b.length + x;
    }
    
    // ========================================================================
    // SECTION 2: METHOD BODY - OBJECT CREATION
    // ========================================================================
    
    public void objectCreationAssignments() {
        // Simple object creation
        Object obj = new Object();
        String str = new String("test");
        StringBuilder sb = new StringBuilder();
        
        // Generic types
        List<String> list = new ArrayList<>();
        Map<String, Integer> map = new HashMap<>();
        Set<Point> pointSet = new HashSet<>();
        
        // Custom types
        Point point = new Point(1, 2);
        Person person = new Person("Alice", 30);
        Box<String> box = new Box<>("content");
        CustomService service = new CustomService();
        
        // Diamond operator with complex generics
        Map<String, List<Integer>> complexMap = new HashMap<>();
        List<Map.Entry<String, Integer>> entryList = new ArrayList<String>();
        
        // Anonymous class creation
        Runnable runnable = new Runnable() {
            public static final int temp = 20;
            @Override
            public void run() {
                int innerVar = 10;
            }

            public int someNumber() {
                int someNumber = 30;
                return someNumber + temp;
            }
        };
        
        Comparator<String> comparator = new Comparator<String>() {
            @Override
            public int compare(String o1, String o2) {
                int result = o1.compareTo(o2);
                return result;
            }
        };
    }
    
    // ========================================================================
    // SECTION 3: METHOD BODY - ARRAY CREATION
    // ========================================================================
    
    public void arrayCreationAssignments() {
        // Array with size
        int[] intArray = new int[10];
        String[] stringArray = new String[5];
        
        // Array with initializer
        int[] initializedArray = {1, 2, 3, 4, 5};
        String[] names = {"Alice", "Bob", "Charlie"};
        
        // Multi-dimensional arrays
        int[][] matrix = new int[3][3];
        int[][] initializedMatrix = {{1, 2}, {3, 4}};
        String[][][] cube = new String[2][2][2];
        
        // Array of custom types
        Point[] points = new Point[3];
        Point[] initializedPoints = {new Point(0, 0), new Point(1, 1)};
        
        // Generic array (with cast)
        @SuppressWarnings("unchecked")
        List<String>[] listArray = (List<String>[]) new List[5];
        
        // Complex annotation cases - multiple annotations
        @SuppressWarnings({"unchecked", "rawtypes"})
        Map rawMap = new HashMap();
        
        @SuppressWarnings({"unchecked", "rawtypes", "deprecation"})
        List rawList = new ArrayList();
        
        // Multiple distinct annotations on same variable
        @Deprecated
        @SuppressWarnings("unused")
        String deprecatedUnused = "old value";
        
        @SuppressWarnings("all")
        @Deprecated
        Object legacyObject = new Object();
        
        // Annotation with array value containing single element
        @SuppressWarnings({"unused"})
        int singleElementArray = 0;
        
        // Multiple annotations with different value types
        @SuppressWarnings(value = {"unchecked", "rawtypes"})
        Set rawSet = new HashSet();
        
        // Nested generic with multiple suppression
        @SuppressWarnings({"unchecked", "rawtypes"})
        Map<String, List> mixedGenericMap = new HashMap<>();
        
        // Array creation with multiple annotations
        @SuppressWarnings({"unchecked"})
        @Deprecated
        List<Integer>[] deprecatedListArray = (List<Integer>[]) new List[10];
    }
    
    // ========================================================================
    // SECTION 4: METHOD BODY - METHOD INVOCATION RESULTS
    // ========================================================================
    
    public void methodInvocationAssignments() {
        // Static method calls
        int maxValue = Integer.MAX_VALUE;
        String formatted = String.format("Value: %d", 42);
        List<String> emptyList = Collections.emptyList();
        CustomService instance = CustomService.getInstance();
        
        // Instance method calls
        String upperCase = "hello".toUpperCase();
        int length = "test".length();
        String substring = "hello world".substring(0, 5);
        
        // Chained method calls
        String chained = "  hello  ".trim().toUpperCase();
        List<String> streamResult = List.of("a", "b", "c").stream()
            .filter(s -> s.length() > 0)
            .collect(Collectors.toList());
        
        // Generic method calls
        Optional<String> optional = Optional.of("value");
        String orElse = optional.orElse("default");
        
        // Custom service method
        CustomService svc = new CustomService();
        String processed = svc.process("input");
    }
    
    // ========================================================================
    // SECTION 5: METHOD BODY - EXPRESSIONS AND OPERATORS
    // ========================================================================
    
    public void expressionAssignments() {
        int a = 10, b = 20;
        
        // Arithmetic expressions
        int sum = a + b;
        int difference = a - b;
        int product = a * b;
        int quotient = a / b;
        int remainder = a % b;
        
        // Compound expressions
        int complex = (a + b) * (a - b) / 2;
        
        // Unary expressions
        int negated = -a;
        int incremented = ++a;
        boolean notTrue = !true;
        int bitwiseNot = ~a;
        
        // Comparison results
        boolean isEqual = a == b;
        boolean isGreater = a > b;
        boolean isLessOrEqual = a <= b;
        
        // Logical expressions
        boolean andResult = true && false;
        boolean orResult = true || false;
        
        // Ternary expression
        int ternaryResult = a > b ? a : b;
        String ternaryString = a > 0 ? "positive" : "non-positive";
        ternaryString += "temp" + b;
        
        // Cast expression
        double d = 3.14;
        int castedInt = (int) d;
        Object obj = "string";
        String castedString = (String) obj;
        
        // Instanceof with cast
        Object maybeString = "test";
        boolean isString = maybeString instanceof String;
    }
    
    // ========================================================================
    // SECTION 6: METHOD BODY - LAMBDAS AND METHOD REFERENCES
    // ========================================================================
    
    public void lambdaAndMethodReferenceAssignments() {
        // Simple lambdas
        Runnable runnable = () -> System.out.println("hello");
        Supplier<String> supplier = () -> "value";
        Consumer<String> consumer = s -> System.out.println(s);
        Function<String, Integer> function = s -> s.length();
        BiFunction<Integer, Integer, Integer> biFunction = (x, y) -> x + y;
        String someString = "hello";
        // Lambda with block body
        Function<String, String> blockLambda = s -> {
            String upper = s.toUpperCase();
            String trimmed = upper.trim();
            return trimmed + someString.toUpperCase();
        };
        
        // Custom functional interface
        Processor<String, Integer> processor = input -> input.length();
        
        // Method references - static
        Function<String, Integer> parseInt = Integer::parseInt;
        Supplier<List<String>> listSupplier = ArrayList::new;
        
        // Method references - instance
        String prefix = "Hello: ";
        Function<String, String> concat = prefix::concat;
        
        // Method references - arbitrary instance
        Function<String, String> toUpper = String::toUpperCase;
        Comparator<String> comparator = String::compareTo;
        
        // Method references - constructor
        Supplier<StringBuilder> sbSupplier = StringBuilder::new;
        Function<String, Point> pointCreator = s -> new Point(s.length(), 0);
    }
    
    // ========================================================================
    // SECTION 7: METHOD BODY - SWITCH EXPRESSIONS (Java 14+)
    // ========================================================================
    
    class SomeClassHelper {
        private final int x;
        private final int y;
        public SomeClassHelper(int x, int y) {
            this.x = x;
            this.y = y;
        }
        public int () {
            return x + y;
        }
    };

    public void switchExpressionAssignments(T t) {
        Status status = Status.ACTIVE;
        Object obj = "test";
        
        // Traditional switch expression with arrow
        String statusText = switch (status) {
            case ACTIVE -> "Active"; break;
            case INACTIVE -> "Inactive"; break;
            case PENDING -> "Pending"; break;
            default -> "Unknown"; break;
        };
        
        // Switch expression with yield
        int statusCode = switch (status) {
            case ACTIVE: yield 1;
            case INACTIVE: yield 0;
            case PENDING: {
                int code = -1;
                yield code;
            }
            default: yield -2;
        };
        
        // Switch with type patterns (Java 21+)
        String typeResult = switch (obj) {
            case String s -> {
                var o = new Object() {
                    int x = 1;
                };
                SomeClassHelper helper = new SomeClassHelper(1, 2);

                yield "String: " + s + " " + o.x + " " + helper.getSum();
            }
            case Integer i -> "Integer: " + i;
            case Point p -> "Point: " + p.x() + "," + p.y();
            case null -> "null";
            default -> "unknown";
        };
        
        // Switch with record patterns (Java 21+)
        Object shape = new Point(3, 4);
        String recordResult = switch (shape) {
            case Point(int x, int y) -> "Point(" + x + "," + y + ")";
            case Person(String name, int age) -> "Person: " + name;
            default -> "other";
        };
        
        // Switch with guards
        String guardedResult = switch (shape) {
            case Point(int x, int y) when x == 0 && y == 0 -> "origin";
            case Point(int x, int y) when x == y -> "diagonal";
            case Point(int x, int y) -> "point";
            default -> "other";
        };
        
        // Switch with instanceof type patterns (testing various types)
        Object mixedObj = getRandomObject();
    }
    
    private Object getRandomObject() {
        return "test";
    }
    
    // ========================================================================
    // SECTION 8: METHOD BODY - PATTERN MATCHING
    // ========================================================================
    
    public void patternMatchingAssignments() {
        Object obj = "hello";
        Object point = new Point(1, 2);
        
        // instanceof pattern (Java 16+)
        if (obj instanceof String s) {
            String upperS = s.toUpperCase();
            int len = s.length();
        }
        
        // instanceof with record pattern (Java 21+)
        if (point instanceof Point(int x, int y)) {
            int sum = x + y;
            int product = x * y;
        }
        
        // Nested record pattern
        Object nested = new Box<>(new Point(1, 2));
        if (nested instanceof Box(Point(int x, int y))) {
            int total = x + y;
        }
    }
    
    // ========================================================================
    // SECTION 9: FOR LOOPS
    // ========================================================================
    
    public void forLoopVariables() {
        // Traditional for loop
        for (int i = 0; i < 10; i++) {
            int squared = i * i;
        }
        
        // Multiple loop variables
        for (int i = 0, j = 10; i < j; i++, j--) {
            int sum = i + j;
        }
        
        // Enhanced for loop (for-each)
        List<String> items = List.of("a", "b", "c");
        for (String item : items) {
            String upper = item.toUpperCase();
        }
        
        // For-each with array
        int[] numbers = {1, 2, 3, 4, 5};
        for (int num : numbers) {
            int doubled = num * 2;
        }
        
        // For-each with custom type
        List<Point> points = List.of(new Point(0, 0), new Point(1, 1));
        for (Point p : points) {
            int sum = p.x() + p.y();
        }
        
        // For-each with var
        for (var entry : Map.of("a", 1, "b", 2).entrySet()) {
            String key = entry.getKey();
            Integer value = entry.getValue();
        }
    }
    
    // ========================================================================
    // SECTION 10: WHILE AND DO-WHILE LOOPS
    // ========================================================================
    
    public void whileLoopVariables() {
        int count = 0;
        
        // While loop with internal variable
        while (count < 10) {
            int current = count;
            int next = count + 1;
            count++;
        }
        
        // Do-while with internal variable
        do {
            int value = count * 2;
            count--;
        } while (count > 0);
    }
    
    // ========================================================================
    // SECTION 11: TRY-CATCH-FINALLY AND TRY-WITH-RESOURCES
    // ========================================================================
    
    public void tryBlockVariables() throws Exception {
        // Basic try-catch
        try {
            int result = Integer.parseInt("123");
            String processed = String.valueOf(result);
        } catch (NumberFormatException e) {
            String message = e.getMessage();
            int errorCode = -1;
        }
        
        // Multiple catch blocks
        try {
            Object obj = null;
            String str = obj.toString();
        } catch (NullPointerException e) {
            String npeMessage = e.getMessage();
        } catch (Exception e) {
            String exMessage = e.getMessage();
        }
        
        // Try-finally
        try {
            int value = 42;
        } finally {
            int cleanup = 0;
        }
        
        // Try-with-resources (Java 7+)
        try (BufferedReader reader = new BufferedReader(new StringReader("test"))) {
            String line = reader.readLine();
            int length = line != null ? line.length() : 0;
        }
        
        // Multiple resources
        try (StringReader sr = new StringReader("data");
             BufferedReader br = new BufferedReader(sr)) {
            String content = br.readLine();
        }
        
        // Var in try-with-resources (Java 11+)
        try (var reader = new BufferedReader(new StringReader("test"))) {
            var line = reader.readLine();
        }
    }
    
    // ========================================================================
    // SECTION 12: SCOPED BLOCKS
    // ========================================================================
    
    public void scopedBlockVariables() {
        int outerVar = 1;
        
        // Simple block
        {
            int blockVar = 2;
            int sum = outerVar + blockVar;
        }
        
        // Nested blocks
        {
            int level1 = 10;
            {
                int level2 = 20;
                {
                    int level3 = 30;
                    int total = level1 + level2 + level3;
                }
            }
        }
        
        // If-else blocks
        boolean condition = true;
        if (condition) {
            int trueVar = 1;
            String trueStr = "true";
        } else {
            int falseVar = 0;
            String falseStr = "false";
        }
        
        // If-else-if chain
        int value = 5;
        if (value < 0) {
            String negative = "negative";
        } else if (value == 0) {
            String zero = "zero";
        } else {
            String positive = "positive";
        }
    }
    
    // ========================================================================
    // SECTION 13: CONSTRUCTOR BODY
    // ========================================================================
    
    private String instanceField;
    private final Local local;

    class Temp {
        public final int n;
        public Temp(int n) {
            this.n = n;
        }

        public int getN() {
            return n;
        }

        public int hashCode() {
            return n;
        }
    }

    class Local {
        public final Temp temp;
        public final String name;
     public Local(final Temp x, final String name) {
        this.temp = x;
        this.name = name;
     }
    }
    
    public LocalVariableExamples() {
        // Local variables in constructor
        int initValue = 42;
        String computed = "prefix_" + initValue;
        local = new Local(new Temp(initValue + 20), "test1");
        this.instanceField = computed + local.name + " " + local.temp.getN() + "  " + local.temp.hashCode();
        
        // Object creation in constructor
        StringBuilder sb = new StringBuilder();
        sb.append(new Local(new Temp(initValue), "test"));
        System.out.print(sb.capacity());
        
        // Custom type in constructor
        Point origin = new Point(0, 0);
    }
    
    public LocalVariableExamples(String param) {
        // Constructor with parameter using local var
        String processed = param.toUpperCase();
        int length = processed.length();
        this.instanceField = processed;
    }
    
    // ========================================================================
    // SECTION 14: STATIC INITIALIZER BLOCK
    // ========================================================================
    
    private static String staticField;
    private static List<String> staticList;
    
    static {
        // Local variables in static block
        int staticInit = 100;
        String computed = "static_" + staticInit;
        staticField = computed;
        
        // Object creation in static block
        List<String> tempList = new ArrayList<>();
        tempList.add("one");
        tempList.add("two");
        staticList = Collections.unmodifiableList(tempList);
        
        // Loop in static block
        for (int i = 0; i < 5; i++) {
            String item = "item_" + i;
        }
    }
    
    // ========================================================================
    // SECTION 15: INSTANCE INITIALIZER BLOCK
    // ========================================================================
    
    private List<Integer> instanceList;
    
    {
        // Local variables in instance initializer
        int instanceInit = 200;
        String prefix = "instance";
        
        // Object creation in instance initializer
        List<Integer> tempList = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            int value = i * instanceInit;
            tempList.add(value);
        }
        instanceList = tempList;
    }
    
    // ========================================================================
    // SECTION 16: LAMBDA BODIES (Nested local variables)
    // ========================================================================
    
    public void lambdaBodyVariables() {
        // Lambda with block body containing local variables
        Function<String, Integer> processor = s -> {
            String trimmed = s.trim();
            String upper = trimmed.toUpperCase();
            int length = upper.length();
            return length;
        };
        
        // Lambda capturing outer variables (effectively final)
        int multiplier = 2;
        Function<Integer, Integer> multiply = x -> {
            int result = x * multiplier;
            return result;
        };
        
        // Nested lambdas
        Function<Integer, Function<Integer, Integer>> adder = x -> {
            int captured = x;
            return y -> {
                int sum = captured + y;
                return sum;
            };
        };
        
        // Lambda in stream
        List<String> items = List.of("apple", "banana", "cherry");
        List<Integer> lengths = items.stream()
            .map(s -> {
                String processed = s.toLowerCase();
                int len = processed.length();
                return len;
            })
            .collect(Collectors.toList());
    }
    
    // ========================================================================
    // SECTION 17: ANONYMOUS CLASS BODIES
    // ========================================================================
    
    public void anonymousClassVariables() {
        // Anonymous class with local variables in method
        Runnable r = new Runnable() {
            @Override
            public void run() {
                int localInAnon = 10;
                String message = "Running: " + localInAnon;
                System.out.println(message);
            }
        };
        
        // Anonymous class with multiple methods
        Comparator<Point> pointComparator = new Comparator<Point>() {
            @Override
            public int compare(Point p1, Point p2) {
                int dist1 = p1.x() * p1.x() + p1.y() * p1.y();
                int dist2 = p2.x() * p2.x() + p2.y() * p2.y();
                int result = Integer.compare(dist1, dist2);
                return result;
            }
            
            @Override
            public boolean equals(Object obj) {
                boolean isEqual = obj instanceof Comparator;
                return isEqual;
            }
        };
        
        // Anonymous class with instance initializer
        Object withInit = new Object() {
            private int field;
            {
                int initVar = 42;
                field = initVar;
            }
        };
    }
    
    // ========================================================================
    // SECTION 18: SYNCHRONIZED BLOCKS
    // ========================================================================
    
    private final Object lock = new Object();
    
    public void synchronizedBlockVariables() {
        synchronized (lock) {
            int syncVar = 100;
            String syncStr = "synchronized: " + syncVar;
            
            // Nested operations
            List<String> list = new ArrayList<>();
            list.add(syncStr);
        }
        
        // Synchronized on this
        synchronized (this) {
            int thisVar = 200;
        }
    }
    
    // ========================================================================
    // SECTION 19: COMPLEX/EDGE CASES
    // ========================================================================
    
    public void complexCases() {
        // Variable shadowing (different scopes, same name)
        int x = 1;
        {
            int x2 = 2; // Can't shadow, using different name
            int y = x + x2;
            {
                int legendaryHello = x2 + y + x + 30;
            }
        }
        
        // Assignment in condition (not recommended but valid)
        String s;
        if ((s = getString()) != null) {
            int len = s.length();
        }
        
        // Chained assignment
        int a, b, c;
        a = b = c = 10;
        
        // Compound assignment operators
        int n = 10;
        n += 5;
        n -= 2;
        n *= 3;
        n /= 2;
        n %= 4;
        
        // Array element assignment (not variable declaration, but related)
        int[] arr = new int[3];
        arr[0] = 1;
        
        // Generic method return
        List<String> list = createList();
        Optional<Point> optPoint = Optional.of(new Point(1, 2));
        Point extracted = optPoint.orElse(new Point(0, 0));
    }
    
    private String getString() { return "test"; }
    private <T> List<T> createList() { return new ArrayList<>(); }
    
    // ========================================================================
    // SECTION 20: RECORD CLASSES (Local variables in record methods)
    // ========================================================================
    
    public record Rectangle(int width, int height) {
        public int area() {
            int result = width * height;
            return result;
        }
        
        public Rectangle scaled(int factor) {
            int newWidth = width * factor;
            int newHeight = height * factor;
            return new Rectangle(newWidth, newHeight);
        }
    }
    
    // ========================================================================
    // SECTION 21: ENUM WITH METHODS
    // ========================================================================
    
    public enum Operation {
        ADD {
            @Override
            public int apply(int a, int b) {
                int result = a + b;
                return result;
            }
        },
        SUBTRACT {
            @Override
            public int apply(int a, int b) {
                int result = a - b;
                return result;
            }
        };
        
        public abstract int apply(int a, int b);
        
        public String describe(int a, int b) {
            int result = apply(a, b);
            String desc = String.format("%d op %d = %d", a, b, result);
            return desc;
        }
    }
    
    // ========================================================================
    // SECTION 22: SEALED CLASSES AND PERMITS
    // ========================================================================
    
    public sealed interface Shape permits Circle, Square {
        default double area() {
            double result = 0.0;
            return result;
        }
    }
    
    public final class Circle implements Shape {
        private final double radius;
        
        public Circle(double r) {
            double validated = r > 0 ? r : 0;
            this.radius = validated;
        }
        
        @Override
        public double area() {
            double squared = radius * radius;
            double result = Math.PI * squared;
            return result;
        }
    }
    
    public final class Square implements Shape {
        private final double side;
        
        public Square(double s) {
            this.side = s;
        }
        
        @Override
        public double area() {
            double result = side * side;
            return result;
        }
    }
    
    // ========================================================================
    // SECTION 23: RECORD VARIABLES AND INSTANTIATION
    // ========================================================================
    
    public record Circle2(double radius) {}
    
    public record NestedRecord<T>(T data, String label) {}
    
    public void recordVariables() {
        // Simple record instantiation stored in variable
        Rectangle rect = new Rectangle(10, 20);
        Circle2 circle = new Circle2(5.0);
        
        // Record with var inference
        var inferredRect = new Rectangle(15, 25);
        var inferredCircle = new Circle2(7.5);
        
        // Generic record instantiation
        NestedRecord<String> stringRecord = (Object) new NestedRecord<>("data", "label");
        NestedRecord<Integer> intRecord = new NestedRecord<>(42, "number");
        NestedRecord<List<String>> complexRecord = new NestedRecord<>(List.of("a", "b"), "list");
        
        // Record with var and generics
        var inferredGenericRecord = new NestedRecord<>("inferred", "type");
        
        // Accessing record components
        int width = rect.width();
        int height = rect.height();
        int area = rect.area();
        
        // Record in collection
        List<Rectangle> rectangles = new ArrayList<>();
        Rectangle first = rectangles.isEmpty() ? new Rectangle(0, 0) : rectangles.get(0);
        
        // Record pattern in local context
        Object obj = new Rectangle(100, 200);
        if (obj instanceof Rectangle(int w, int h)) {
            int localArea = w * h;
            String desc = "Area: " + localArea;
        }
    }
    
    // ========================================================================
    // SECTION 24: SUPPLIER AND FUNCTIONAL INTERFACE LAMBDAS
    // ========================================================================
    
    public void supplierLambdas() {
        // Basic Supplier with lambda
        Supplier<String> stringSupplier = () -> {
            String computed = "computed value";
            return computed;
        };
        
        // Supplier with block body and multiple statements
        Supplier<Integer> intSupplier = () -> {
            int base = 10;
            int multiplier = 5;
            int result = base * multiplier;
            return result;
        };
        
        // Supplier with var
        var inferredSupplier = (Supplier<Double>) () -> {
            double pi = Math.PI;
            double squared = pi * pi;
            return squared;
        };
        
        // Supplier returning custom type
        Supplier<Rectangle> rectSupplier = () -> {
            int w = 100;
            int h = 200;
            Rectangle rect = new Rectangle(w, h);
            return rect;
        };
        
        // Supplier returning collection
        Supplier<List<String>> listSupplier = () -> {
            List<String> items = new ArrayList<>();
            String item1 = "first";
            String item2 = "second";
            items.add(item1);
            items.add(item2);
            return items;
        };
        
        // Consumer with local variables
        Consumer<String> consumer = (String input) -> {
            String processed = input.toUpperCase();
            int length = processed.length();
            String result = processed + " (" + length + ")";
        };
        
        // Function with local variables
        Function<String, Integer> function = (String s) -> {
            String trimmed = s.trim();
            int length = trimmed.length();
            return length;
        };
        
        // BiFunction with local variables
        BiFunction<Integer, Integer, String> biFunction = (Integer a, Integer b) -> {
            int sum = a + b;
            int product = a * b;
            String result = "Sum: " + sum + ", Product: " + product;
            return result;
        };
        
        // Predicate with local variables
        Predicate<String> predicate = (String s) -> {
            String lower = s.toLowerCase();
            boolean startsWithA = lower.startsWith("a");
            boolean endsWithZ = lower.endsWith("z");
            boolean result = startsWithA && endsWithZ;
            return result;
        };
        
        // Using the suppliers
        String suppliedString = stringSupplier.get();
        Integer suppliedInt = intSupplier.get();
        Rectangle suppliedRect = rectSupplier.get();
    }
    
    // ========================================================================
    // SECTION 25: NESTED LAMBDAS WITH LOCAL VARIABLES AT EACH LAYER
    // ========================================================================
     
    public void someFunctions() {
        (x) -> {
            int y = 10;
            return 100 + y;
        }
    }
    native void nestedLambdasWithLocalVariables(int a,int b);
    public void nestedLambdasWithLocalVariables() {
        // Level 0: Method scope local variable
        String outerMethodVar = "method level";
        int outerCounter = 0;
        
        // Level 1: First lambda layer
        Supplier<Supplier<String>> level1Supplier = () -> {
            // Level 1 local variables
            String level1Var = "level 1";
            int level1Counter = 1;
            StringBuilder level1Builder = new StringBuilder();
            
            // Level 2: Second lambda layer (nested inside first)
            Supplier<String> level2Supplier = () -> {
                // Level 2 local variables
                String level2Var = "level 2";
                int level2Counter = 2;
                List<String> level2List = new ArrayList<>();
                
                // Can reference outer variables (effectively final)
                String combined = outerMethodVar + " -> " + level1Var + " -> " + level2Var;
                int total = outerCounter + level1Counter + level2Counter;
                
                return combined + " (total: " + total + ")";
            };
            
            return level2Supplier;
        };
        
        // Three levels deep with different functional interfaces
        Function<String, Function<Integer, Supplier<Boolean>>> threeLevelNested = 
            (String param1) -> {
                // Level 1 locals
                String level1Processed = param1.toUpperCase();
                int level1Length = level1Processed.length();
                
                return (Integer param2) -> {
                    // Level 2 locals
                    int level2Sum = level1Length + param2;
                    double level2Ratio = (double) param2 / level1Length;
                    
                    return () -> {
                        // Level 3 locals
                        boolean level3Result = level2Sum > 10;
                        String level3Message = "Result: " + level3Result;
                        int level3Final = level2Sum * 2;
                        
                        return level3Result;
                    };
                };
            };
        
        // Nested lambdas in stream operations
        List<List<Integer>> nestedLists = List.of(
            List.of(1, 2, 3),
            List.of(4, 5, 6)
        );

        
        List<Integer> flattened = nestedLists.stream()
            .flatMap(innerList -> {
                // Level 1 in stream lambda
                int innerSize = innerList.size();
                String innerDesc = "Processing list of size " + innerSize;
                
                return innerList.stream()
                    .map(num -> {
                        // Level 2 in nested stream lambda
                        int doubled = num * 2;
                        int withSize = doubled + innerSize;
                        return withSize;
                    });
            })
            .collect(Collectors.toList());
        
        // Lambda inside lambda inside anonymous class
        Runnable complexNested = new Runnable() {
            // Anonymous class field
            private int anonField = 100;
            
            @Override
            public void run() {
                // Method local in anonymous class
                int methodLocal = 50;
                
                Supplier<Integer> innerSupplier = () -> {
                    // Lambda level 1 local
                    int lambdaLocal1 = 25;
                    
                    Function<Integer, Integer> innerFunction = (Integer x) -> {
                        // Lambda level 2 local
                        int lambdaLocal2 = 10;
                        int result = x + lambdaLocal1 + lambdaLocal2 + methodLocal + anonField;
                        return result;
                    };
                    
                    int computed = innerFunction.apply(5);
                    return computed;
                };
                
                Integer finalResult = innerSupplier.get();
            }
        };
        
        // Consumer chain with nested lambdas
        Consumer<List<String>> processList = (List<String> items) -> {
            // Outer lambda locals
            int totalLength = 0;
            StringBuilder aggregator = new StringBuilder();
            
            items.forEach(item -> {
                // Inner lambda locals (note: can't modify totalLength directly)
                String processed = item.trim();
                int itemLength = processed.length();
                String formatted = "[" + processed + "]";
                
                // Use effectively final aggregator
                aggregator.append(formatted);
            });
            
            String finalAggregate = aggregator.toString();
        };
        
        // Deeply nested with type inference (var)
        var deepNested = (Supplier<Supplier<Supplier<String>>>) () -> {
            var level1Data = "L1";
            var level1Num = 1;
            
            return () -> {
                var level2Data = level1Data + "-L2";
                var level2Num = level1Num + 1;
                
                return () -> {
                    var level3Data = level2Data + "-L3";
                    var level3Num = level2Num + 1;
                    var finalResult = level3Data + ":" + level3Num;
                    return finalResult;
                };
            };
        };
        
        // Execute and store results
        Supplier<Supplier<String>> resultLevel1 = level1Supplier.get();
        Supplier<String> resultLevel2 = resultLevel1.get();
        String finalString = resultLevel2.get();
        
        // Execute three-level
        Function<Integer, Supplier<Boolean>> partial1 = threeLevelNested.apply("test");
        Supplier<Boolean> partial2 = partial1.apply(5);
        Boolean finalBool = partial2.get();
    }
}
