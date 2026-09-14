package com.inventory.auth.examples5;

import com.inventory.auth.domain.Session;
import com.inventory.auth.initialization.DataInitializer;

import java.util.List;
/**
 * Basic test cases for LiteralType extraction.
 * Covers: INTEGER, LONG, FLOAT, DOUBLE, BOOLEAN, CHARACTER, STRING, TEXT_BLOCK, NULL
 */
public class LiteralTypeTestCases<T, U extends Number> {

    // Generic inner class with literals
    abstract class Box<V> {
        protected V value;
        protected String tag = "base";
        protected int priority = 0;
    }

    class StringBox extends Box<String> {
        public StringBox() {
            this.value = "hello";
            this.tag = "string-box";
        }
        private String localField = "local";
    }

    class IntegerBox extends Box<Integer> {
        public IntegerBox() {
            this.value = 42;
            this.tag = "integer-box";
        }
        private int sum = 10 + 20;
        // private int temporaryField = priority + this.priority + 5;
    }

    // Using class type parameters
    private T genericField;
    private U numberField;
    
    public void useGenerics(T param, U num) {
        String label = "processing: ";
        int count = 5;
        this.genericField = param;
        this.numberField = num;
    }

    // ==================== INTEGER LITERALS ====================
    private int basicInt = 42;
    private int hexInt = 0x2A;
    private int binaryInt = 0b101010;
    private int octalInt = 052;                    // Octal (42 in decimal)
    private int underscoreInt = 1_000_000;         // Underscore separator
    private int maxInt = 2147483647;               // Integer.MAX_VALUE
    private int minInt = -2147483648;              // Integer.MIN_VALUE (unary)
    private int zeroInt = 0;
    private int hexUpperInt = 0XABC;               // Uppercase X
    private int binaryUpperInt = 0B1010;           // Uppercase B

    // ==================== LONG LITERALS ====================
    private long basicLong = 42L;
    private long hexLong = 0xFFFFFFFFFFL;
    private long lowercaseLong = 42l;              // Lowercase l suffix
    private long binaryLong = 0b1010L;             // Binary with L
    private long octalLong = 0777L;                // Octal with L
    private long underscoreLong = 1_000_000_000L;  // Underscore separator
    private long maxLong = 9223372036854775807L;   // Long.MAX_VALUE

    // ==================== FLOAT LITERALS ====================
    private float basicFloat = 3.14f;
    private Number eFloat = 1e1;
    private float scientificFloat = 1.5e-4f;
    private float uppercaseFloat = 3.14F;          // Uppercase F
    private float hexFloat = 0x1.0p0f;             // Hex float
    private float leadingDotFloat = .5f;           // Leading dot
    private float trailingDotFloat = 5.f;          // Trailing dot
    private float underscoreFloat = 3.141_592f;    // Underscore
    private float zeroFloat = 0.0f;
    private float scientificUpperFloat = 1.5E4F;   // Uppercase E and F

    // ==================== DOUBLE LITERALS ====================
    private double basicDouble = 3.14159265359;
    private double scientificDouble = 6.022E23;
    private double explicitDouble = 3.14d;         // Explicit d suffix
    private double uppercaseDouble = 3.14D;        // Uppercase D
    private double hexDouble = 0x1.0p0;            // Hex double
    private double hexDoubleWithSuffix = 0x1.0p0d; // Hex with d
    private double leadingDotDouble = .5;          // Leading dot
    private double trailingDotDouble = 5.;         // Trailing dot
    private double underscoreDouble = 3.141_592_653; // Underscore
    private double zeroDouble = 0.0;
    private double negativeExpDouble = 1.5e-10;    // Negative exponent

    // ==================== BOOLEAN LITERALS ====================
    private boolean trueValue = true;
    private boolean falseValue = false;

    // ==================== CHARACTER LITERALS ====================
    private char basicChar = 'a';
    private char escapeChar = '\n';
    private char unicodeChar = '\u0041';
    private char octalEscapeChar = '\101';         // Octal escape (A)
    private char nullChar = '\0';                  // Null character
    private char tabChar = '\t';
    private char crChar = '\r';
    private char backslashChar = '\\';
    private char singleQuoteChar = '\'';
    private char doubleQuoteChar = '"';
    private char backspaceChar = '\b';
    private char formFeedChar = '\f';

    // ==================== STRING LITERALS ====================
    private String emptyString = "";
    private String simpleString = "Hello, World!";
    private String withEscapes = "line1\nline2";
    private String unicodeString = "Hello \u0041 World";  // Unicode in string
    private String allEscapes = "\t\n\r\f\b\\\"\'";       // All escape chars
    private String surrogatePair = "\uD83D\uDE00";        // Emoji (surrogate pair)
    private String nullInString = "before\0after";        // Null char in string
    private String singleChar = "x";
    private String numericString = "12345";
    private String mixedQuotes = "He said \"Hello\"";

    // ==================== TEXT_BLOCK LITERALS (Java 15+) ====================
    private String basicTextBlock = """
            Hello,
            World!
            """;
    private String emptyTextBlock = """
            """;
    private String escapedQuotesTextBlock = """
            She said \"""Hello\"""
            """;
    private String lineContinuationTextBlock = """
            This is a \
            single line
            """;
    private String indentedTextBlock = """
        {
            "name": "test",
            "value": 42
        }
        """;

    // ==================== NULL LITERALS ====================
    private String nullString = null;
    private Object nullObject = null;
    private Integer nullInteger = null;
    private int[] nullArray = null;

    // ==================== CLASS LITERALS ====================
    // Reference types
    private Class<?> stringClass = String.class;
    private Class<?> sessionClass = Session.class;
    private Class<?> objectClass = Object.class;
    
    // Primitive types
    private Class<?> intClass = int.class;
    private Class<?> longClass = long.class;
    private Class<?> doubleClass = double.class;
    private Class<?> floatClass = float.class;
    private Class<?> booleanClass = boolean.class;
    private Class<?> charClass = char.class;
    private Class<?> byteClass = byte.class;
    private Class<?> shortClass = short.class;
    
    // Void
    private Class<?> voidClass = void.class;
    
    // Array types
    private Class<?> intArrayClass = int[].class;
    private Class<?> stringArrayClass = String[].class;
    private Class<?> multiDimArrayClass = int[][].class;
    private Class<?> objectArrayClass = Object[].class;
    
    // Fully qualified
    private Class<?> listClass = List.class;
    private Class<?> mapClass = java.util.Map.class;
    private Class<?> tempClass = DataInitializer.TempClass.class;

    // Literals in expressions
    private int sum = 10 + 20;
    private String concat = "Hello" + " " + "World";
    private int ternary = true ? 1 : 0;

    // Array initializers
    private int[] intArray = {1, 2, 3};
    private String[] stringArray = {"one", "two"};

    // Method calls with literal arguments
    private String formatted = String.format("Value: %d", 42);

    // Constants
    public static final int CONSTANT_INT = 100;
    public static final String CONSTANT_STRING = "CONSTANT";
}
