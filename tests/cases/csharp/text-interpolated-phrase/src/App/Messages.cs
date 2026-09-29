using System;

namespace App
{
    public class Messages
    {
        public void RequireScope(string scope)
        {
            throw new ArgumentException($"no indexed file has '{scope}' in its path");
        }

        public string Quota(string user, int n)
        {
            return string.Format("quota for {0} is exhausted after {1} requests", user, n);
        }

        public string Sealed(string name)
        {
            return "the archive " + name + " was never sealed";
        }

        public object[] FarApart(int n)
        {
            var note = "the ledger is";
            var total = n + 1;
            return new object[] { note, total, "out of balance" };
        }
    }
}
