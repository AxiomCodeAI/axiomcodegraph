package pkg.one;
public enum State {
    Header { void step() { } },
    Body { void step() { } };
    abstract void step();
}
