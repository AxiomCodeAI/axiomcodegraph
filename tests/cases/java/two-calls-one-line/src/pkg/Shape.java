package pkg;

public class Shape {
    private final Point center;

    public Shape(Point center) { this.center = center; }

    public Point getCenter() { return center; }

    // A second overload of the SAME name. `impact Shape.getCenter` resolves to BOTH, and the
    // grouped row stands for both — so a line calling each of them once is two sites, not one.
    public Point getCenter(int unused) { return center; }
}
