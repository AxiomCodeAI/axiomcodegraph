using System.Collections;
using System.Collections.Generic;

namespace App;

public record Config(string Culture)
{
    public bool HasHeader { get; init; } = true;
    public int Size { get; set; }
}

public class Parser { public int Row { get; set; } }
public class Context { public Parser Parser { get; set; } }

public class MemberMap { public bool IsSet { get; set; } }
public class MemberMaps : IEnumerable<MemberMap>
{
    public IEnumerator<MemberMap> GetEnumerator() { yield break; }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}

public class Result { public int Remainder { get; } }
public delegate Result Parse(string text);
public static class Parsers { public static Parse Integer { get; } = t => new Result(); }

public abstract class Concern { public virtual void Context() { } public void SetUp() { Context(); } }
public class Outer { public class WhenHandling : Concern { public override void Context() { Work.Mark(); } } }
public static class Work { public static void Mark() { } }

public static class Use
{
    public static Config Init() => new Config("x") { HasHeader = false, Size = 4 };
    public static int Chain(Context c) => c?.Parser?.Row ?? 0;
    public static void Loop(MemberMaps maps) { foreach (var m in maps) { if (m.IsSet) { } } }
    public static int Plain(Parser p) => p.Row;
    public static int Through() { var r = Parsers.Integer("1"); return r.Remainder; }
}
