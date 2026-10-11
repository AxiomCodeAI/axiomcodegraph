using System;
using System.Collections;
using System.Collections.Generic;

namespace Files
{
    public abstract class Sink { }

    public class Writer : Sink, IDisposable
    {
        public void Write(string s) { }
        public void Dispose() { }
    }

    public class Book
    {
        public void Read() { }
    }

    public class Shelf : IEnumerable<Book>
    {
        public void Read() { }
        public IEnumerator<Book> GetEnumerator() { yield break; }
        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    public class Jobs
    {
        public void Statement()
        {
            using (var w = new Writer())
            {
                w.Write("a");
            }
        }

        public void Declaration()
        {
            using var w = new Writer();
            w.Write("b");
        }

        public void Loop(Shelf shelf)
        {
            // control: a foreach variable takes the ELEMENT type, never the collection's
            foreach (var b in shelf) b.Read();
        }
    }
}
