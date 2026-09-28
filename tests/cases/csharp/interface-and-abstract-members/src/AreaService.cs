namespace Shapes
{
    public class AreaService
    {
        public double Total(IShape[] shapes)
        {
            double t = 0;
            foreach (IShape s in shapes) { t += s.Area(); }
            return t;
        }

        public string Print(Report r) { return r.Render(); }
    }
}
