package com.inventory.auth.examples17;

import java.util.List;
import java.util.Optional;

/**
 * Comprehensive test cases for Java 21+ Record Pattern extraction.
 * Tests: simple patterns, nested patterns, generic records, guarded patterns,
 * switch expressions with patterns, and various edge cases.
 */
public class RecordPatternExamples {

    // ========================================
    // Record Definitions
    // ========================================
    
    // Simple records
    record Point(int x, int y) {}
    record Point3D(int x, int y, int z) {}
    record Person(String name, int age) {}
    record Employee(String name, int id, Department dept) {}
    record Department(String name, String code) {}
    
    // Nested structure records
    record Address(String street, String city, String zip) {}
    record Contact(String email, String phone) {}
    record Customer(String name, Address address, Contact contact) {}
    
    // Generic records
    record Pair<T, U>(T first, U second) {}
    record Triple<A, B, C>(A a, B b, C c) {}
    record Box<T>(T value) {}
    record Result<T>(T data, String status) {}
    
    // Deep nesting records
    record Outer(Middle middle) {}
    record Middle(Inner inner) {}
    record Inner(String value) {}
    
    // Array component record
    record Matrix(int[][] data, int rows, int cols) {}
    
    // ========================================
    // Test Fields - Simple Record Patterns
    // ========================================
    
    Object pointObj = new Point(10, 20);
    Object personObj = new Person("Alice", 30);
    
    // Simple 2-component pattern
    String simplePoint = pointObj instanceof Point(int x, int y) 
        ? "(" + x + ", " + y + ")" 
        : "not a point";
    
    // Simple 2-component with String
    String simplePerson = personObj instanceof Person(String name, int age)
        ? name + " is " + age + " years old"
        : "unknown";
    
    // 3-component pattern
    Object point3DObj = new Point3D(1, 2, 3);
    String point3D = point3DObj instanceof Point3D(int x, int y, int z)
        ? "3D: " + x + ", " + y + ", " + z
        : "not 3D";
    
    // ========================================
    // Test Fields - Nested Record Patterns (2 levels)
    // ========================================
    
    Object employeeObj = new Employee("Bob", 123, new Department("Engineering", "ENG"));
    
    // Nested pattern - extract department components
    String nestedEmployee = employeeObj instanceof Employee(String name, int id, Department(String deptName, String code))
        ? name + " #" + id + " in " + deptName + " (" + code + ")"
        : "not employee";
    
    // ========================================
    // Test Fields - Nested Record Patterns (3 levels)
    // ========================================
    
    Object customerObj = new Customer(
        "Charlie",
        new Address("123 Main St", "Boston", "02101"),
        new Contact("charlie@email.com", "555-1234")
    );
    
    // 3-level nesting - extract all components
    String nestedCustomer = customerObj instanceof Customer(
            String name,
            Address(String street, String city, String zip),
            Contact(String email, String phone))
        ? name + ": " + street + ", " + city + " " + zip + " | " + email + " | " + phone
        : "not customer";
    
    // ========================================
    // Test Fields - Deep Nesting (4+ levels)
    // ========================================
    
    Object outerObj = new Outer(new Middle(new Inner("deep value")));
    
    // 4-level deep nesting
    String deepNesting = outerObj instanceof Outer(Middle(Inner(String value)))
        ? "Deep: " + value
        : "not outer";
    
    // ========================================
    // Test Fields - Generic Record Patterns
    // ========================================
    
    Object pairObj = new Pair<>("hello", 42);
    Object tripleObj = new Triple<>("a", "b", "c");
    Object boxObj = new Box<>(new Point(5, 5));
    Object resultObj = new Result<>(new Person("Dave", 25), "success");
    
    // Generic pair pattern
    String genericPair = pairObj instanceof Pair(String s, Integer i)
        ? s + " -> " + i
        : "not pair";
    
    // Generic triple pattern
    String genericTriple = tripleObj instanceof Triple(String a, String b, String c)
        ? a + b + c
        : "not triple";
    
    // Generic with nested record
    String genericBoxNested = boxObj instanceof Box(Point(int x, int y))
        ? "Boxed point: " + x + ", " + y
        : "not boxed point";
    
    // Generic with nested record extraction
    String genericResultNested = resultObj instanceof Result(Person(String name, int age), String status)
        ? status + ": " + name + " age " + age
        : "not result";
    
    // ========================================
    // Test Fields - Guarded Patterns (when clause)
    // ========================================
    
    Object guardedPointObj = new Point(100, 200);
    
    // Pattern with guard - positive coordinates
    String guardedPositive = guardedPointObj instanceof Point(int x, int y) && x > 0 && y > 0
        ? "positive point: " + x + ", " + y
        : "not positive";
    
    // Pattern with guard - age check
    Object guardedPersonObj = new Person("Eve", 17);
    String guardedAdult = guardedPersonObj instanceof Person(String name, int age) && age >= 18
        ? name + " is an adult"
        : "not an adult";
    
    // Complex guard with nested pattern
    Object guardedCustomerObj = new Customer("Frank", new Address("456 Oak", "NYC", "10001"), new Contact("f@x.com", "555"));
    String guardedNested = guardedCustomerObj instanceof Customer(String name, Address(String street, String city, String zip), Contact c)
            && city.equals("NYC")
        ? name + " is in NYC at " + street
        : "not NYC customer";
    
    // ========================================
    // Test Fields - Multiple instanceof in expression
    // ========================================
    
    Object obj1 = new Point(1, 1);
    Object obj2 = new Person("Grace", 40);
    
    // Multiple patterns in ternary chain
    String multiPattern = obj1 instanceof Point(int x, int y)
        ? "point: " + x + "," + y
        : obj1 instanceof Person(String name, int age)
            ? "person: " + name
            : "unknown";
    
    // Combined patterns with &&
    String combinedPatterns = obj1 instanceof Point(int x, int y) && obj2 instanceof Person(String name, int age)
        ? "Point(" + x + "," + y + ") and Person(" + name + "," + age + ")"
        : "mismatch";
    
    // ========================================
    // Test Fields - Var in patterns
    // ========================================
    
    Object varPatternObj = new Point(7, 8);
    
    // Using var instead of explicit type
    String varPattern = varPatternObj instanceof Point(var x, var y)
        ? "var point: " + x + ", " + y
        : "not point";
    
    // ========================================
    // Test Fields - Underscore patterns (Java 22+)
    // Note: May not parse in all tree-sitter versions
    // ========================================
    
    // Object underscoreObj = new Point(9, 10);
    // String underscorePattern = underscoreObj instanceof Point(int x, _)
    //     ? "x only: " + x
    //     : "not point";
    
    // ========================================
    // Test Fields - Patterns in complex expressions
    // ========================================
    
    Object complexObj = new Employee("Hank", 999, new Department("Sales", "SLS"));
    
    // Pattern in method call argument
    String inMethodCall = String.valueOf(
        complexObj instanceof Employee(String name, int id, Department(String dept, String code))
            ? name + "#" + id
            : "none"
    );
    
    // Pattern in array initializer
    String[] patternInArray = {
        complexObj instanceof Employee(String name, int id, Department d)
            ? name : "n/a",
        complexObj instanceof Employee(String n, int id, Department(String dept, String code))
            ? dept : "n/a"
    };
    
    // Pattern in binary expression
    int patternInBinary = (complexObj instanceof Employee(String name, int id, Department d) ? id : 0) + 100;
    
    // ========================================
    // Test Fields - Null handling
    // ========================================
    
    Object nullObj = null;
    
    // Pattern on null - should not match
    String nullPattern = nullObj instanceof Point(int x, int y)
        ? "point: " + x + ", " + y
        : "null or not point";
    
    // ========================================
    // Test Methods with Record Patterns
    // ========================================
    
    public String methodWithPattern(Object obj) {
        if (obj instanceof Point(int x, int y)) {
            return "Point: " + x + ", " + y;
        }
        return "not a point";
    }
    
    public String methodWithNestedPattern(Object obj) {
        if (obj instanceof Customer(String name, Address(String street, String city, String zip), Contact contact)) {
            return name + " lives at " + street + ", " + city + " " + zip;
        }
        return "not a customer";
    }
    
    public String methodWithGuardedPattern(Object obj) {
        if (obj instanceof Person(String name, int age) && age >= 21) {
            return name + " can drink";
        }
        return "cannot drink";
    }
    
    // ========================================
    // Test Methods - Switch with Record Patterns
    // ========================================

    Object randomTest = switch (obj) {
            case Customer(String name, Address(String street, String city, String zip), Contact c) 
                -> name + " at " + city;
            case Employee(String name, int id, Department(String dept, String code))
                -> name + " in " + dept;
            case null, default -> "unknown";
        };
    
    public String switchWithPatterns(Object obj) {
        return switch (obj) {
            case Point(int x, int y) -> "Point(" + x + ", " + y + ")";
            case Person(String name, int age) -> "Person: " + name + ", " + age;
            case Employee(String name, int id, Department dept) -> "Employee: " + name;
            case null -> "null";
            default -> "unknown";
        };
    }
    
    public String switchWithNestedPatterns(Object obj) {
        return switch (obj) {
            case Customer(String name, Address(String street, String city, String zip), Contact c) 
                -> name + " at " + city;
            case Employee(String name, int id, Department(String dept, String code))
                -> name + " in " + dept;
            case null, default -> "unknown";
        };
    }
    
    public String switchWithGuardedPatterns(Object obj) {
        return switch (obj) {
            case Point(int x, int y) when x > 0 && y > 0 -> "Q1";
            case Point(int x, int y) when x < 0 && y > 0 -> "Q2";
            case Point(int x, int y) when x < 0 && y < 0 -> "Q3";
            case Point(int x, int y) when x > 0 && y < 0 -> "Q4";
            case Point(int x, int y) -> "origin or axis";
            case null, default -> "not a point";
        };
    }
    
    // ========================================
    // Test Methods - Exhaustive switch
    // ========================================
    
    sealed interface Shape permits Circle, Rectangle, Triangle {}
    record Circle(double radius) implements Shape {}
    record Rectangle(double width, double height) implements Shape {}
    record Triangle(double a, double b, double c) implements Shape {}
    
    public double area(Shape shape) {
        return switch (shape) {
            case Circle(double r) -> Math.PI * r * r;
            case Rectangle(double w, double h) -> w * h;
            case Triangle(double a, double b, double c) -> {
                double s = (a + b + c) / 2;
                yield Math.sqrt(s * (s - a) * (s - b) * (s - c));
            }
        };
    }
    
    // ========================================
    // Test Fields - Edge cases
    // ========================================
    
    // Single component record
    record Single(String only) {}
    Object singleObj = new Single("alone");
    String singlePattern = singleObj instanceof Single(String only)
        ? "single: " + only
        : "not single";
    
    // Many components record
    record Many(int a, int b, int c, int d, int e) {}
    Object manyObj = new Many(1, 2, 3, 4, 5);
    String manyPattern = manyObj instanceof Many(int a, int b, int c, int d, int e)
        ? "sum: " + (a + b + c + d + e)
        : "not many";
    
    // Record with array type component
    record WithArray(int[] values, String label) {}
    Object arrayRecordObj = new WithArray(new int[]{1, 2, 3}, "test");
    String arrayRecordPattern = arrayRecordObj instanceof WithArray(int[] vals, String label)
        ? label + ": " + vals.length + " items"
        : "not with array";
    
    // ========================================
    // Test - Anonymous Class with Field Initializers using Record Patterns
    // ========================================
    
    // Anonymous class with field that uses record pattern in initializer
    Object anonWithRecordPattern = new Object() {
        Object testObj = new Person("Bob", 25);
        
        // Field initializer with record pattern - should be extracted
        String anonFieldPattern = testObj instanceof Person(String name, int age)
            ? "anon: " + name + " is " + age
            : "not person";
        
        // Nested record pattern in anonymous class field
        Object nestedTestObj = new Customer("Jane", new Address("123 Main", "Boston", "02101"), new Contact("jane@email.com", "555-1234"));
        String anonNestedPattern = nestedTestObj instanceof Customer(String cname, Address(String street, String city, String zip), Contact c)
            ? "anon customer: " + cname + " in " + city
            : "not customer";
    };
}
