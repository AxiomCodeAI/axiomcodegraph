using System.Collections.Generic;

namespace App;

public class Fmt
{
    public static string Format(string a, object b) => a;
    public void Add(string x) { }
}

public class Result
{
    public List<string> Errors { get; } = new List<string>();
    public Fmt Own { get; } = new Fmt();
    public List<string> raw = new List<string>();
}

public static class Use
{
    public static string Keyword(int id) => string.Format("{0}", id);
    public static void Property(Result r) { r.Errors.Add("x"); }
    public static void Field(Result r) { r.raw.Add("x"); }
    public static void Mine(Result r) { r.Own.Add("x"); }
    public static string Direct() => Fmt.Format("{0}", 1);
}
