package com.inventory.auth.examples15;

import java.util.List;
import java.util.ArrayList;

public class SwitchExpressionExamples {
    Object obj = "hello";
    int num = 5;
    String status = "ACTIVE";
    
    // ==================== BASIC ARROW SYNTAX ====================
    
    // Basic switch expression with multiple labels
    String dayType = switch(num) {
        case 1, 7 -> "Weekend";
        case 2, 3, 4, 5, 6 -> "Weekday";
        default -> "Unknown";
    };
    
    // Switch with method invocation as selector
    int length = switch(obj.toString()) {
        case "hello" -> 5;
        case "world" -> 5;
        default -> 0;
    };
    
    // Switch with binary expression results
    int computed = switch(num) {
        case 1 -> num * 2;
        case 2 -> num + 10;
        default -> num - 1;
    };
    
    // ==================== YIELD IN BLOCKS ====================
    
    // Block with yield
    int yieldExample = switch(num) {
        case 1 -> {
            int temp = num * 2;
            yield temp + 1;
        }
        case 2 -> {
            if (num > 0) {
                yield 100;
            }
            yield 0;
        }
        default -> 0;
    };
    
    // ==================== COLON SYNTAX WITH YIELD ====================
    
    // Traditional colon syntax
    int colonYield = switch(num) {
        case 1:
            yield 10;
        case 2:
        case 3:
            yield 20;
        default:
            yield 0;
    };
    
    // ==================== PATTERN MATCHING WITH GUARDS ====================
    
    // Pattern with guard (when clause)
    String guardedPattern = switch(obj) {
        case String s when s.length() > 5 -> "long string";
        case String s when s.isEmpty() -> "empty";
        case String s -> "short string";
        default -> "other";
    };
    
    // ==================== THROW IN SWITCH ARM ====================
    
    // Throw statement as result
    String throwInSwitch = switch(num) {
        case 1 -> "one";
        case 2 -> throw new IllegalArgumentException("error");
        default -> "other";
    };
    
    // ==================== COMPLEX SELECTORS ====================
    
    // Field access as selector
    int fieldSelector = switch(this.num) {
        case 1 -> 10;
        default -> 0;
    };
    
    // Binary expression as selector
    int binarySelector = switch(num + 1) {
        case 2 -> 10;
        default -> 0;
    };
    
    // Method invocation as selector
    int methodSelector = switch(getStatus()) {
        case 1 -> 10;
        default -> 0;
    };
    
    // ==================== COMPLEX RESULTS ====================
    
    // Object creation as result
    List<String> listResult = switch(num) {
        case 1 -> new ArrayList<String>();
        case 2 -> new ArrayList<>(10);
        default -> List.of("default");
    };
    
    // Cast expression as result
    Object castResult = switch(num) {
        case 1 -> (Object) "string";
        case 2 -> (Object) Integer.valueOf(42);
        default -> null;
    };
    
    // Array access as result
    String[] arr = {"a", "b", "c"};
    String arrayResult = switch(num) {
        case 0 -> arr[0];
        case 1 -> arr[1];
        default -> arr[2];
    };
    
    // Ternary as result
    String ternaryResult = switch(num) {
        case 1 -> num > 0 ? "positive" : "zero";
        default -> "other";
    };
    
    // ==================== NESTED SWITCH ====================
    
    // Nested switch expression
    int nested = switch(num) {
        case 1 -> switch(status) {
            case "ACTIVE" -> 100;
            default -> 50;
        };
        case 2 -> 200;
        default -> 0;
    };
    
    private int getStatus() {
        return 1;
    }

    java.util.function.Consumer<List<String>> complexResult = switch(num) {
        case 1 -> new java.util.function.Consumer<List<String>>() {
            @Override
            public void accept(List<String> list) {
                list.forEach(System.out::println);  // Method ref inside anonymous
            }
        };
        case 2 -> list -> list.stream()
                            .map(String::toUpperCase)  // Method ref in lambda
                            .forEach(System.out::println);
        default -> List::clear;  // Direct method reference
    };
}
