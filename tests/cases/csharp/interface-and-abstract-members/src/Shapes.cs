namespace Shapes
{
    public interface IShape { double Area(); }

    public class Circle : IShape
    {
        private readonly double r;
        public Circle(double r) { this.r = r; }
        public double Area() { return 3.14 * r * r; }
    }

    public class Sq : IShape
    {
        private readonly double s;
        public Sq(double s) { this.s = s; }
        public double Area() { return s * s; }
    }

    public abstract class Report
    {
        public abstract string Render();
    }

    public class TextReport : Report
    {
        public override string Render() { return "text"; }
    }
}
