package pkg;

public class Painter {
    // control: a local of a CLIENT type built with `new` stays pinned to what was built
    double paint() {
        final Shape s = new Circle();
        return s.area();
    }

    // control: a client static call keeps its edge
    int clamp(int a) { return Report.max(a, 0); }
}
