using System;
using System.Collections;
using System.Collections.Generic;

namespace App;

public class Reader : IDisposable
{
    public void Dispose() { Flush(); }
    private void Flush() { }
}

public class Bag : IEnumerable<int>
{
    public void Add(int x) { }
    public void Add(int x, int y) { }
    public int Size { get; set; }
    public IEnumerator<int> GetEnumerator() { yield return 1; }
    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
}
