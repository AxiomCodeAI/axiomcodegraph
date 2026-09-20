package pkg;

public class Service {
    // the change. No test method calls it: a fixture does, one level up an inheritance chain.
    public int touch() { return 7; }
}
