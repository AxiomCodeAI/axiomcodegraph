package pkg;

public class ShapeRenderer {
    public String render(Shape shape) {
        String label = shape.getCenter().getX() + "," + shape.getCenter().getY();
        Point p = shape.getCenter();
        int y = shape.getCenter().getY();
        return label + p.getX() + y;
    }

    // one line, one call to EACH overload: the row is keyed on the query, so both live behind it
    public String both(Shape shape) {
        return shape.getCenter().getX() + "/" + shape.getCenter(1).getY();
    }
}
