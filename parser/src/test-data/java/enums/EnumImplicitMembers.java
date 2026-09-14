package com.axiomcode.test.enums;

/**
 * Acceptance fixture for the members JLS 8.9 declares implicitly on an enum.
 *
 * The oracle is javac: compile this file and run `javap -p`. Note what that
 * reports and what it does NOT, because both matter:
 *
 *   public static E[] values();          <- JLS 8.9.3, always implicit
 *   public static E valueOf(String);     <- JLS 8.9.3, always implicit
 *   private E();                         <- JLS 8.9.2, only when none declared
 *
 *   private static final E[] $VALUES;    <- class-file artifact, NOT extracted
 *   private static E[] $values();        <- class-file artifact, NOT extracted
 *   static {};                           <- constant initialiser, NOT extracted
 *
 * values() and valueOf(String) differ from a record's implicit members in that
 * they can never be written by hand - declaring either is a compile error - so
 * they are present on every enum below without exception.
 */
public class EnumImplicitMembers {

    /**
     * No declared constructor, so javac also declares a private no-arg one.
     */
    public enum Simple {
        RED, GREEN, BLUE
    }

    /**
     * Declares a constructor, so javac declares NO default one. This enum has
     * exactly one constructor, the private WithCtor(int) below.
     */
    public enum WithCtor {
        ONE(1), TWO(2);

        private final int value;

        WithCtor(int value) {
            this.value = value;
        }

        public int value() {
            return value;
        }
    }

    /**
     * A constant with a body still leaves the enum itself with the same three
     * implicit members; the anonymous body's method belongs to the constant.
     */
    public enum WithBody {
        ACTIVE {
            @Override
            public String describe() {
                return "active";
            }
        },
        IDLE {
            @Override
            public String describe() {
                return "idle";
            }
        };

        public abstract String describe();
    }

    /**
     * An empty enum still gets values(), valueOf(String) and a private
     * constructor - there is nothing about a constant that induces them.
     */
    public enum Empty {
    }
}
