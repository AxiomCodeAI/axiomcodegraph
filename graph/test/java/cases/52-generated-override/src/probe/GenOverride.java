package probe;

import lombok.Getter;

/**
 * A method an annotation processor declares can IMPLEMENT an interface method. The
 * dispatch fan reaches it through method_name_in_type, but virtual-dispatch.dl builds
 * method_override and virtual_override from the IR tables directly, so the override
 * side excluded it and `overrides` under-reported.
 *
 * Every subject sits beside a hand-written control on the same interface, so the two
 * are distinguished by the member's ORIGIN and by nothing else.
 */
public class GenOverride {

    interface Named {
        String getName();
        String describe();
    }

    /** SUBJECT: getName() is annotation-declared. CONTROL: describe() is written out. */
    static class Person implements Named {
        @Getter private String name;

        public String describe() {
            return "person";
        }
    }

    /** CONTROL: both written out, so both must appear in overrides. */
    static class Robot implements Named {
        public String getName() {
            return "r2";
        }

        public String describe() {
            return "robot";
        }
    }

    static String viaInterface(Named n) {
        return n.getName() + n.describe();
    }

    public static void main(String[] args) {
        viaInterface(new Person());
        viaInterface(new Robot());
    }
}
