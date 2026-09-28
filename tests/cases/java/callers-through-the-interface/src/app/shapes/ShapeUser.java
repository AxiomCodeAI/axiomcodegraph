package app.shapes;

public class ShapeUser {
    public double total(Shape s) {
        return s.area();
    }

    public double squareOnly(Square sq) {
        return sq.area();
    }

    public double make() {
        Shape a = new Circle();
        Shape b = new Square();
        return a.area() + b.area();
    }
}
