package com.inventory.auth.examples13;

/**
 * Test cases for ARRAY_ACCESS expression extraction.
 * 
 * Array access: array[index]
 * - array: qualifier expression (QUALIFIER edge role)
 * - index: index expression (ARRAY_INDEX edge role)
 */
public class ArrayAccessExamples {

    // ==================== BASIC ARRAY ACCESS ====================

    // Simple array with literal index
    int[] numbers = {10, 20, 30};
    int firstNumber = numbers[0];
    int secondNumber = numbers[1];

    // String array access
    String[] names = {"Alice", "Bob", "Charlie"};
    String firstName = names[0];

    // Object array access
    Object[] objects = {new Object(), "string", 42};
    Object firstObject = objects[0];

    // ==================== VARIABLE INDEX ====================

    int index = 1;
    int valueAtIndex = numbers[index];

    // Expression as index
    int valueAtExpr = numbers[index + 1];

    // Method call as index
    int valueAtMethod = numbers[getIndex()];

    private static int getIndex() { return 0; }

    // ==================== MULTI-DIMENSIONAL ARRAY ACCESS ====================

    // 2D array
    int[][] matrix = {{1, 2}, {3, 4}};
    int topLeft = matrix[0][0];
    int bottomRight = matrix[1][1];

    // 3D array
    int[][][] cube = {{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}};
    int cubeElement = cube[0][1][0];

    // ==================== CHAINED ARRAY ACCESS ====================

    // Array of arrays (jagged)
    int[][] jagged = new int[3][];
    // Access would be: jagged[0][0] after initialization

    // ==================== ARRAY ACCESS ON EXPRESSION RESULTS ====================

    // Array access on method return
    int[] getNumbers() { return new int[] {1, 2, 3}; }
    int fromMethod = getNumbers()[0];

    // Array access on field access
    static class Container {
        int[] values = {100, 200, 300};
    }
    Container container = new Container();
    int fromField = container.values[0];

    // Array access on new expression
    int fromNew = new int[] {5, 10, 15}[1];

    // ==================== ARRAY ACCESS WITH COMPLEX INDICES ====================

    class Method {
        public int getValue() {
            return 0;
        }
    }

    // Ternary as index
    boolean condition = true;
    int ternaryIndex = numbers[condition ? 0 : 1];

    // Binary expression as index
    int offset = 1;
    int binaryIndex = numbers[offset * 2];

    // Nested array access as index
    int[] indices = {0, 1, 2};
    int nestedIndex = numbers[indices[0]];

    // ==================== ARRAY ACCESS ON VARIOUS TYPES ====================

    // Primitive arrays
    byte[] bytes = {1, 2, 3};
    byte firstByte = bytes[0];

    short[] shorts = {100, 200};
    short firstShort = shorts[0];

    long[] longs = {1000L, 2000L};
    long firstLong = longs[0];

    float[] floats = {1.0f, 2.0f};
    float firstFloat = floats[0];

    double[] doubles = {1.0, 2.0};
    double firstDouble = doubles[0];

    char[] chars = {'a', 'b', 'c'};
    char firstChar = chars[0];

    boolean[] booleans = {true, false};
    boolean firstBoolean = booleans[0];

    // ==================== ARRAY ACCESS IN EXPRESSIONS ====================

    // Array access as operand
    int sum = numbers[0] + numbers[1];
    boolean isEqual = numbers[0] == numbers[1];

    double val = doubles[new Method().getValue()];

    // Array access in method argument
    String formatted = String.valueOf(numbers[0]);

    // Array access in array initializer
    int[] derived = {numbers[0], numbers[1], numbers[2]};

    // ==================== ARRAY ACCESS WITH METHOD REFERENCE ====================

    // Method reference on array element (array[i]::method)
    String[] strings = {"hello", "world"};
    java.util.function.Supplier<String> upperSupplier = strings[0]::toUpperCase;
    java.util.function.Supplier<String> upperSupplier2 = strings[new Method().getValue()]::toUpperCase;

    // Method reference on multi-dimensional array element
    Object[][] objMatrix = {{new Object()}, {new Object()}};
    java.util.function.Supplier<String> toStringSupplier = objMatrix[0][0]::toString;

    // ==================== ARRAY ACCESS ON CAST EXPRESSION ====================

    Object arrayObj = new int[] {1, 2, 3};
    int fromCast = ((int[]) arrayObj)[0];

    // Cast with generics
    Object listArrayObj = new java.util.ArrayList[2];
    @SuppressWarnings("unchecked")
    java.util.ArrayList<String> fromGenericCast = ((java.util.ArrayList<String>[]) listArrayObj)[0];

    // ==================== ARRAY ACCESS ON PARENTHESIZED ====================

    int fromParen = (numbers)[0];  // Parenthesized array reference
    int fromParenExpr = (getNumbers())[0];

    // ==================== INCREMENT/DECREMENT AS INDEX ====================

    int preIncIdx = 0;
    int withPreInc = numbers[++preIncIdx];   // Pre-increment index
    int withPostInc = numbers[preIncIdx++];  // Post-increment index
    int withPreDec = numbers[--preIncIdx];   // Pre-decrement index

    // ==================== ASSIGNMENT EXPRESSION AS INDEX (rare) ====================

    int assignIdx;
    int withAssignIndex = numbers[assignIdx = 1];  // Assignment as index

    // ==================== ARRAY ACCESS AS METHOD RECEIVER ====================

    // Method call on array access result
    int strLength = strings[0].length();
    char charAtZero = strings[0].charAt(0);

    // Chained method calls on array element
    String upperFirst = strings[0].toUpperCase().trim();

    // ==================== ARRAY ACCESS ON THIS ====================

    int fromThis = this.numbers[0];  // Explicit this

    // ==================== GENERIC ARRAY ACCESS ====================

    @SuppressWarnings("unchecked")
    java.util.List<String>[] genericArray = new java.util.ArrayList[2];
    java.util.List<String> fromGenericArray = genericArray[0];

    // ==================== CAST AS INDEX ====================

    long longIndex = 1L;
    int withCastIndex = numbers[(int) longIndex];

    // ==================== ARRAY ACCESS IN TERNARY BRANCHES ====================

    int ternaryAccess = condition ? numbers[0] : numbers[1];
    int[] arr1 = {1}, arr2 = {2};
    int ternaryArray = (condition ? arr1 : arr2)[0];  // Ternary result as array

    // ==================== MULTI-DIMENSIONAL ARRAY ACCESS ====================
    // Tree structure for matrix[i][j]:
    // ARRAY_ACCESS (ROOT)           <- matrix[i][j]
    //   ├── ARRAY_ACCESS (QUALIFIER) <- matrix[i]
    //   │     ├── IDENTIFIER_REFERENCE 'matrix' (QUALIFIER)
    //   │     └── LITERAL 'i' (ARRAY_INDEX)
    //   └── LITERAL 'j' (ARRAY_INDEX)
    String[][] stringMatrix = {{"a", "b"}, {"c", "d"}};
    String matrixElement = stringMatrix[0][1];

    // ==================== ARRAY ACCESS AS LVALUE (write contexts) ====================

    int[] mutable = {1, 2, 3};
    int mutIdx = 1;
    int lvalueAssign = mutable[0] = 99;

    // Compound assignment on array element
    int lvaluePlusEq = mutable[mutIdx] += 5;

    // Post/pre increment on array element
    int lvaluePostInc = mutable[mutIdx]++;  // value before increment
        int lvaluePreInc = ++mutable[mutIdx];   // value after increment
        int lvaluePostDec = mutable[mutIdx]--;
        int lvaluePreDec = --mutable[mutIdx];

    // ==================== MORE QUALIFIER VARIANTS ====================

    // Assignment expression as qualifier
    int[] q1 = {1, 2};
    int[] q2 = {3, 4};
    int assignmentQualifierAccess = (q1 = q2)[1];

    // New array with dimensions as qualifier (needs parentheses)
    int newDimQualifierAccess = (new int[3])[0];
    int newDimExprQualifierAccess = (new int[index + 2])[1];

    // Jagged: initialize inner array + access (assignment as qualifier)
    int jaggedInitAndAccess = (jagged[0] = new int[] {11, 22})[1];

    // ==================== MORE INDEX VARIANTS ====================

    int iField = 0;

    // Compound assignment as index
    int compoundIndexAccess = numbers[iField += 1];

    // Boxed Integer as index (unboxing)
    Integer boxedIndex = 0;
    int unboxedIndexAccess = numbers[boxedIndex];

    // Char as index (char -> int widening)
    char charIndex = 1;
    int charIndexAccess = numbers[charIndex];

    // Unary plus/minus in index
    int unaryPlusIndexAccess = numbers[+index];
    int unaryMinusIndexAccess = numbers[-0];

    // ==================== STATIC FIELD QUALIFIER ====================

    static int[] STATIC_ARR = {9, 8, 7};
    int staticQualifierAccess = ArrayAccessExamples.STATIC_ARR[0];

    // ==================== SUPER QUALIFIER ====================

    static class Parent {
        int[] parentArr = {5, 6};
    }

    static class Child extends Parent {
        // super.parentArr[0] as field initializer
        int superQualifierAccess = super.parentArr[0];
    }

    // ==================== FIELD ACCESS ON ARRAY ELEMENT ====================

    // .length field on array element (matrix[0] is an array)
    int firstRowLength = matrix[0].length;

    // ==================== CLONE + CAST ====================

    // Method invocation returning Object + cast + array access
    int cloneCastAccess = ((int[]) numbers.clone())[0];
}
