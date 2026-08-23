// Pattern: EXTEND A JDK CLASS AND OVERRIDE ITS METHODS.
// A user type subclasses a concrete JDK class, overrides methods, and often
// calls super.<jdkMethod>(...) so the override delegates back into the JDK.
import java.util.ArrayList;

public class InheritanceOverride {

    // Subclass of java.util.ArrayList that overrides add(...) and calls super.
    static class LoggingList<E> extends ArrayList<E> {
        @Override
        public boolean add(E element) {
            System.out.println("LoggingList: adding " + element);
            return super.add(element); // delegate to JDK ArrayList.add
        }

        @Override
        public E remove(int index) {
            System.out.println("LoggingList: removing index " + index);
            return super.remove(index); // delegate to JDK ArrayList.remove
        }
    }

    // Subclass of java.lang.Exception overriding getMessage().
    static class TaggedException extends Exception {
        private final String tag;

        TaggedException(String tag, String message) {
            super(message); // JDK constructor
            this.tag = tag;
        }

        @Override
        public String getMessage() {
            return "[" + tag + "] " + super.getMessage(); // super into JDK
        }
    }

    public static void main(String[] args) {
        LoggingList<String> list = new LoggingList<>();
        list.add("x");
        list.add("y");
        list.remove(0);
        System.out.println("final list = " + list);

        try {
            throw new TaggedException("IO", "disk full");
        } catch (TaggedException e) {
            System.out.println("caught: " + e.getMessage());
        }
    }
}
