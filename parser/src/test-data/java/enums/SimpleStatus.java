package com.example.enums;

import java.io.Serializable;
import java.util.List;
import java.util.Map;
import java.time.Duration;
import java.math.BigDecimal;
import org.example.custom.MyCustomClass;
import org.example.custom.AnotherType;

/**
 * Comprehensive test file for enum constant extraction
 * Tests various enum patterns including:
 * - Simple enum constants (no arguments)
 * - Enum constants with arguments
 * - Enum constants with annotations
 * - Enum constants with anonymous class bodies
 * - Enum methods (both on the enum and constant overrides)
 */

// Simple enum with no arguments
public enum SimpleStatus {
    ACTIVE,
    INACTIVE,
    PENDING,
    DELETED
}

// Enum with constructor arguments
enum StatusWithArgs {
    ACTIVE("Active", 1),
    INACTIVE("Inactive", 0),
    PENDING("Pending", 2),
    UNKNOWN("Unknown", -1);
    
    private final String label;
    private final int code;
    
    StatusWithArgs(String label, int code) {
        this.label = label;
        this.code = code;
    }
    
    public String getLabel() {
        return label;
    }
    
    public int getCode() {
        return code;
    }
}

// Enum with annotations on constants
enum AnnotatedStatus {
    @Deprecated
    LEGACY,
    
    @SuppressWarnings("unused")
    CURRENT,
    
    @Deprecated
    @SuppressWarnings("all")
    OLD_FORMAT
}

// Enum with anonymous class bodies (method overrides)
enum StatusWithBody {
    ACTIVE("Active") {
        @Override
        public boolean isTransient() {
            return false;
        }
        
        @Override
        public String getDisplayName() {
            return "Currently Active";
        }
    },
    INACTIVE("Inactive") {
        @Override
        public boolean isTransient() {
            return false;
        }
    },
    PENDING("Pending") {
        @Override
        public boolean isTransient() {
            return true;
        }
        
        public void customMethod() {
            // Custom method only in PENDING
        }
    };
    
    private final String label;
    
    StatusWithBody(String label) {
        this.label = label;
    }
    
    public abstract boolean isTransient();
    
    public String getDisplayName() {
        return label;
    }
}

// Enum implementing interface
enum HttpMethod implements Serializable {
    GET("GET", true),
    POST("POST", false),
    PUT("PUT", false),
    DELETE("DELETE", false),
    PATCH("PATCH", false);
    
    private final String method;
    private final boolean idempotent;
    
    HttpMethod(String method, boolean idempotent) {
        this.method = method;
        this.idempotent = idempotent;
    }
    
    public String getMethod() {
        return method;
    }
    
    public boolean isIdempotent() {
        return idempotent;
    }
}

// Complex enum with multiple argument types including class literals
enum ComplexEnum {
    @Deprecated
    ITEM_A("A", 1, 1.5, true, new String[]{"tag1", "tag2"}, String.class),
    
    ITEM_B("B", 2, 2.5, false, new String[]{"tag3"}, Integer.class),
    
    @SuppressWarnings("unchecked")
    ITEM_C("C", 3, 3.5, true, null, BigDecimal.class) {
        @Override
        public String getInfo() {
            return "Special Item C";
        }
    },
    
    // Test with custom class literal
    ITEM_D("D", 4, 4.5, true, null, MyCustomClass.class),
    
    // Test with field access (enum constant reference)
    ITEM_E("E", 5, 5.5, false, null, Serializable.class);
    
    private final String name;
    private final int id;
    private final double value;
    private final boolean active;
    private final String[] tags;
    private final Class<?> type;
    
    ComplexEnum(String name, int id, double value, boolean active, String[] tags, Class<?> type) {
        this.name = name;
        this.id = id;
        this.value = value;
        this.active = active;
        this.tags = tags;
        this.type = type;
    }
    
    public String getInfo() {
        return name + ":" + id;
    }
    
    public Class<?> getType() {
        return type;
    }
}

// Enum with static methods and fields
enum EnumWithStatics {
    VALUE_1,
    VALUE_2,
    VALUE_3;
    
    private static final String PREFIX = "ENUM_";
    
    public static EnumWithStatics fromString(String value) {
        return valueOf(value);
    }
    
    static {
        // Static initializer
        System.out.println("EnumWithStatics loaded");
    }
}

// Nested enum inside a class
class OuterClass {
    public enum NestedEnum {
        NESTED_A,
        NESTED_B("B", 2) {
            @Override
            public String getDescription() {
                return "Nested B with body";
            }
        };
        
        private final String label;
        private final int code;
        
        NestedEnum() {
            this.label = name();
            this.code = ordinal();
        }
        
        NestedEnum(String label, int code) {
            this.label = label;
            this.code = code;
        }
        
        public String getDescription() {
            return label;
        }
    }
}

// Enum with abstract method implemented in each constant
enum Operation {
    PLUS {
        int apply(int a, int b) { return a + b; }
    },
    MINUS {
        int apply(int a, int b) { return a - b; }
    },
    MULTIPLY {
        int apply(int a, int b) { return a * b; }
    };
    
    abstract int apply(int a, int b);
}

// Enum with custom imported types to test potentialQualifiedName resolution
enum ConfigType {
    // Tests java.util.List import
    LIST_CONFIG(new List[]{}),
    
    // Tests java.math.BigDecimal import
    DECIMAL_CONFIG(new BigDecimal("100.50")),
    
    // Tests java.time.Duration import
    DURATION_CONFIG(Duration.ofSeconds(30)),
    
    // Tests custom import org.example.custom.MyCustomClass
    CUSTOM_CONFIG(new MyCustomClass()),
    
    // Tests custom import org.example.custom.AnotherType
    ANOTHER_CONFIG(new AnotherType()),
    
    // Tests same-package type (no import needed)
    SAME_PACKAGE_CONFIG(new LocalType()),
    
    // Tests unimported type (should resolve to same package with ambiguity)
    UNIMPORTED_CONFIG(new UnknownType());
    
    private final Object value;
    
    ConfigType(Object value) {
        this.value = value;
    }
    
    public Object getValue() {
        return value;
    }
}

// Local type in same package for testing
class LocalType {}
