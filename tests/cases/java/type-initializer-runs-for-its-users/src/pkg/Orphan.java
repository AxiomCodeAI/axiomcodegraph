package pkg;

// control: a static field initializer of a type no test touches selects no test
public final class Orphan {
    static final int VALUE = Unused.compute();

    static int value() { return VALUE; }
}
