using System;
using System.Collections;
using System.Collections.Generic;

namespace App;

public class Holder(Func<int, int> fn)
{
    private readonly Func<int, int> _fn = fn ?? Zero;
    public int Run(int x) => _fn(x);
    private static int Zero(int x) => 0;
}

public class Direct(Func<int, int> handler)
{
    public int Run(int x) => handler.Invoke(x);
}

public class Stored
{
    private Action _act;
    public Stored(Action act) { _act = act; }
    public void Go() { _act(); }
}

public static class Api
{
    public static void Each(Action<int> act) { act(1); }
    public static void Wrap(Action<int> act) { Each(act); }
    public static void Maybe(Action? act) { act?.Invoke(); }
    public static void Keep(Action<int> act) { }
}

public class Rules : IEnumerable<int>
{
    public void Add(Func<Rules, int> creator) { creator(this); }
    public int RuleFor(string name) => Work.Do(1);
    public IEnumerator<int> GetEnumerator() { yield break; }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
