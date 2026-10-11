using System;
using System.Collections.Generic;
using System.Reflection;

namespace App
{
    public static class Dispatch
    {
        public static object Run(string evt, Dictionary<string, object> doc)
        {
            MethodInfo m = typeof(Handlers).GetMethod(evt);
            return m.Invoke(null, new object[] { doc });
        }

        public static object RunTable(Dictionary<string, Func<Dictionary<string, object>, object>> table, string key, Dictionary<string, object> doc)
        {
            return table[key](doc);
        }

        public static object Purge(Dictionary<string, object> doc)
        {
            MethodInfo m = typeof(Handlers).GetMethod("OnPurge");
            return m.Invoke(null, new object[] { doc });
        }

        public static object SaveAndAudit(Dictionary<string, object> doc)
        {
            return Handlers.Audit(doc);
        }
    }
}
