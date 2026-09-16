package pkg;
public class Holder {
    static class Inner { private Payload payload; Inner(Payload p) { this.payload = p; } }
    static class Sibling { void nothing() { } }
    Inner make(Payload p) { return new Inner(p); }
    Sibling other() { return new Sibling(); }
}
