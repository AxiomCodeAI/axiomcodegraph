namespace App;

public static class Use
{
    public static void Chain(IOptions<int, string> o) { o.Then(() => { }); }
    public static int Counted(IOptions<int, string> o) { return o.Count; }
    public static int Sized(IPlain p) { return p.Size; }
    public static int Length(IPlain p) { p.Len = 2; return p.Len; }
    public static string Indexed(IPlain p) { return p[0]; }
    public static int Areas(Shape s) { return s.Area; }
    public static string Named(Shape s) { return s.Name; }
    public static int SquareOnly(Square q) { return q.Area; }
}
