package com.inventory.auth.examples25;

import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.function.Supplier;
import java.util.HashMap;

/**
 * Comprehensive examples for testing control flow variable and expression linkage.
 */
public class ControlFlowExamples {


    private final Supplier<Object> random = (k) -> {
        for (int n = 0; n < k; n++) {
            int forBodyVar = n;
            if (forBodyVar < 25) {
                int lowVar = forBodyVar * 2;
                System.out.println("Low: " + lowVar);
            } else if (forBodyVar < 75) {
                int midVar = forBodyVar + 50;
                System.out.println("Mid: " + midVar);
            } else {
                int highVar = forBodyVar - 25;
                System.out.println("High: " + highVar);
            }
        }

        int temp = 100;

        while(temp > 0) {
            temp--;
        }
    };

    // ==================== WHILE LOOP EXAMPLES ====================

    /**
     * Basic while loop with variables inside
     */
    public void basicWhileLoop() {
        int counter = 0;
        while (counter < 10) {
            int insideWhile = counter * 2;
            String message = "Count: " + insideWhile;
            System.out.println(message);
            counter++;
        }
    }

    /**
     * Nested while loops
     */
    public void nestedWhileLoops() {
        int outer = 0;
        while (outer < 5) {
            int outerVar = outer * 10;
            int inner = 0;
            while (inner < 3) {
                int innerVar = outerVar + inner;
                System.out.println("Value: " + innerVar);
                inner++;
                while(innerVar > 4) {
                    int innerInnerVar = innerVar * 2;
                    System.out.println("Inner Inner Var: " + innerInnerVar);
                    innerVar--;
                }
            }
            outer++;
        }
    }

    /**
     * While loop inside lambda
     */
    public void whileInsideLambda(List<Integer> numbers) {
        numbers.forEach(num -> {
            int lambdaVar = num;
            while (lambdaVar > 0) {
                int whileInLambda = lambdaVar * 2;
                System.out.println(whileInLambda);
                lambdaVar--;
            }
        });
    }

    /**
     * While with if inside
     */
    public void whileWithIfInside() {
        int i = 0;
        while (i < 20) {
            int whileVar = i;
            if (whileVar % 2 == 0) {
                int evenVar = whileVar / 2;
                System.out.println("Even: " + evenVar);
            } else if(whileVar %5 ==0) {
                int res = whileVar / 5;
                System.out.println("Multiple of 5: " + res);
            } else if(whileVar %7 ==0) {
                try {
                    int res = whileVar /7;
                    System.out.println("Some res: " + res);
                } catch(Exception e) {
                    throw e;
                }
            } else if(whileVar %9 ==0) {
                int res = whileVar / 9;
                System.out.println("Multiple of 9: " + res);
            } else if(whileVar %30 == 1) {
                int res = whileVar / 30;
                System.out.println("Multiple of 30: " + res);
            } else {
                int something = 123;
                try {
                    int oddVar = whileVar * 3 + 1;
                    System.out.println("Odd: " + oddVar);
                } catch(Exception e) {
                    String less = "Less than 123";
                    throw e;
                }
            }
            i++;
        }
    }

    // ==================== DO-WHILE LOOP EXAMPLES ====================

    /**
     * Basic do-while loop
     */
    public void basicDoWhileLoop() {
        int count = 0;
        do {
            int insideDoWhile = count + 100;
            System.out.println(insideDoWhile);
            count++;
        } while (count < 5);
    }

    /**
     * Nested do-while loops
     */
    public void nestedDoWhileLoops() {
        int x = 0;
        do {
            int outerDoWhile = x * 5;
            int y = 0;
            do {
                int innerDoWhile = outerDoWhile + y;
                System.out.println(innerDoWhile);
                y++;
            } while (y < 2);
            x++;
        } while (x < 3);
    }

    // ==================== FOR LOOP EXAMPLES ====================

    /**
     * Basic for loop with multiple variables in init
     */
    public void basicForLoop() {
        for (int i = 0, j = 10; i < j; i++, j--) {
            int forVar = i + j;
            System.out.println(forVar);
        }
    }

    /**
     * For loop with external variable (variable declared outside)
     */
    public void forWithExternalVariable() {
        int external = 0;
        for (; external < 10; external++) {
            int insideFor = external * 2;
            System.out.println(insideFor);
        }
    }

    /**
     * For loop with assignment expression in update
     */
    public void forWithAssignmentUpdate() {
        for (int i = 0; i < 100; i = i + 5) {
            System.out.println(i);
        }
    }

    /**
     * For loop with compound assignment and multiple updates
     */
    public void forWithCompoundAssignment() {
        for (int i = 0, j = 100; i < j; i += 10, j -= 5) {
            int diff = j - i;
            System.out.println(diff);
        }
    }

    /**
     * For loop with method call in update
     */
    public void forWithMethodCallUpdate(List<Integer> list) {
        for (int i = 0; i < 10; list.add(i++)) {
            System.out.println("Added: " + i);
        }
    }

    /**
     * For loop with negation/boolean toggle in update
     */
    public void forWithBooleanToggle() {
        boolean flag = true;
        for (int i = 0; i < 10; i++, flag = !flag) {
            String state = flag ? "ON" : "OFF";
            System.out.println(i + ": " + state);
        }
    }

    /**
     * Nested for loops
     */
    public void nestedForLoops() {
        for (int row = 0; row < 5; row++) {
            int rowVar = row * 10;
            for (int col = 0; col < 5; col++) {
                int colVar = col + rowVar;
                System.out.println("Cell: " + colVar);
            }
        }
    }

    /**
     * For loop inside lambda
     */
    public void forInsideLambda(List<String> items) {
        items.forEach(item -> {
            int lambdaLocalVar = item.length();
            for (int idx = 0; idx < lambdaLocalVar; idx++) {
                char c = item.charAt(idx);
                int charCode = (int) c;
                System.out.println("Char " + idx + ": " + charCode);
            }
        });
    }

    /**
     * For loop with if/else inside
     */
    public void forWithConditionals() {
        for (int n = 0; n < 100; n++) {
            int forBodyVar = n;
            if (forBodyVar < 25) {
                int lowVar = forBodyVar * 2;
                System.out.println("Low: " + lowVar);
            } else if (forBodyVar < 75) {
                int midVar = forBodyVar + 50;
                System.out.println("Mid: " + midVar);
            } else {
                int highVar = forBodyVar - 25;
                System.out.println("High: " + highVar);
            }
        }
    }

    // ==================== ENHANCED FOR LOOP EXAMPLES ====================

    /**
     * Enhanced for with nested regular for
     */
    public void enhancedForWithNestedFor(List<String> strings) {
        for (String str : strings) {
            int strLen = str.length();
            for (int i = 0; i < strLen; i++) {
                char ch = str.charAt(i);
                System.out.println(ch);
            }
        }
    }

    /**
     * Enhanced for with while inside
     */
    public void enhancedForWithWhile(List<Integer> nums) {
        for (Integer num : nums) {
            int current = num;
            while (current > 0) {
                int whileInEnhancedFor = current % 10;
                System.out.println(whileInEnhancedFor);
                current = current / 10;
            }
        }
    }

    // ==================== SWITCH STATEMENT EXAMPLES ====================

    /**
     * Traditional switch statement with variables in cases
     */
    public void traditionalSwitch(int value) {
        switch (value) {
            case 1:
                int caseOneVar = value * 10;
                System.out.println(caseOneVar);
                break;
            case 2:
                int caseTwoVar = value * 20;
                System.out.println(caseTwoVar);
                break;
            case 3:
            case 4:
                int caseThreeFourVar = value * 30;
                System.out.println(caseThreeFourVar);
                break;
            default:
                int defaultVar = value * 100;
                System.out.println(defaultVar);
        }
    }

    /**
     * Switch statement with loops inside cases
     */
    public void switchWithLoopsInCases(int mode, List<String> items) {
        switch (mode) {
            case 1:
                for (String item : items) {
                    int itemLen = item.length();
                    System.out.println(itemLen);
                }
                break;
            case 2:
                int idx = 0;
                while (idx < items.size()) {
                    String current = items.get(idx);
                    System.out.println(current);
                    idx++;
                }
                break;
            default:
                for (int i = 0; i < items.size(); i++) {
                    int position = i + 1;
                    System.out.println("Item " + position);
                }
        }
    }

    // ==================== SWITCH EXPRESSION EXAMPLES (Java 14+) ====================

    /**
     * Switch expression with arrow syntax
     */
    public String switchExpression(int day) {
        String dayType = switch (day) {
            case 1, 2, 3, 4, 5 -> {
                int workDay = day;
                String result = "Weekday " + workDay;
                yield result;
            }
            case 6, 7 -> {
                int weekend = day - 5;
                String result = "Weekend day " + weekend;
                yield result;
            }
            default -> {
                int unknown = day;
                yield "Unknown day: " + unknown;
            }
        };
        return dayType;
    }

    /**
     * Switch expression with pattern matching (Java 21+)
     */
    public String switchWithPatternMatching(Object obj) {
        return switch (obj) {
            case Integer o -> {
                int doubled = i * 2;
                yield "Integer: " + doubled;
            }
            case String s -> {
                int len = s.length();
                yield "String of length: " + len;
            }
            case List<?> list -> {
                int size = list.size();
                yield "List of size: " + size;
            }
            case null -> {
                String nullMsg = "null value";
                yield nullMsg;
            }
            default -> {
                String className = obj.getClass().getName();
                yield "Unknown type: " + className;
            }
        };
    }

    /**
     * Switch expression inside a loop
     */
    public void switchExpressionInLoop(List<Integer> values) {
        for (Integer val : values) {
            int loopVar = val;
            String category = switch (loopVar % 3) {
                case 0 -> {
                    int divisible = loopVar / 3;
                    something.forEach((insideHere) -> {
                        int insideLambda = insideHere * 2;
                        System.out.println(insideLambda);
                    });
                    yield "Divisible by 3: " + divisible;
                }
                case 1 -> {
                    int remainder1 = loopVar - 1;
                    yield "Remainder 1: " + remainder1;
                }
                case 2 -> {
                    int remainder2 = loopVar - 2;
                    yield "Remainder 2: " + remainder2;
                }
                default -> "Unexpected";
            };
            System.out.println(category);
        }
    }

    /**
     * Switch expression inside lambda
     */
    public void switchExpressionInLambda(List<String> items) {
        items.forEach(item -> {
            int itemLength = item.length();
            String size = switch (itemLength) {
                case 0, 1, 2 -> {
                    int tiny = itemLength;
                    yield "Tiny: " + tiny;
                }
                case 3, 4, 5 -> {
                    int small = itemLength;
                    yield "Small: " + small;
                }
                default -> {
                    int large = itemLength;
                    yield "Large: " + large;
                }
            };
            System.out.println(size);
        });
    }

    // ==================== COMPLEX NESTED EXAMPLES ====================

    /**
     * Deeply nested control flow
     */
    public void deeplyNested(List<List<Integer>> matrix) {
        for (List<Integer> row : matrix) {
            int rowSum = 0;
            for (Integer cell : row) {
                int cellValue = cell;
                if (cellValue > 0) {
                    int positiveVal = cellValue;
                    while (positiveVal > 10) {
                        int whileVar = positiveVal / 2;
                        positiveVal = whileVar;
                    }
                    rowSum += positiveVal;
                } else if (cellValue < 0) {
                    int negativeVal = -cellValue;
                    do {
                        int doWhileVar = negativeVal * 2;
                        negativeVal = doWhileVar;
                    } while (negativeVal < 10);
                    rowSum -= negativeVal;
                }
            }
            System.out.println("Row sum: " + rowSum);
        }
    }

    /**
     * Mixed control flow with synchronized
     */
    public void mixedWithSynchronized(List<Integer> shared) {
        for (Integer val : shared) {
            int localVal = val;
            synchronized (shared) {
                int syncVar = localVal * 2;
                if (syncVar > 100) {
                    int ifInSync = syncVar - 100;
                    System.out.println("Over 100: " + ifInSync);
                } else {
                    int elseInSync = 100 - syncVar;
                    System.out.println("Under 100: " + elseInSync);
                }
            }
        }
    }
}
