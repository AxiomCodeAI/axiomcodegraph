package pkg;

import java.util.List;

public class Sizer {
    // the arguments are untyped calls into the platform, but the operator says what they are
    Bag shrink(List<Node> all) { return new Bag(all.size() - 1); }

    void rewind(Bag b, int i) { b.drop(--i); }

    void mark(Bag b, List<Node> all) { b.flag(all.size() > 1); }

    // control: a node argument still reaches the reference overloads
    Bag wrap(Node n) { return new Bag(n); }
}
