using System.Collections.Generic;

namespace App
{
    public static class Handlers
    {
        public static Dictionary<string, object> OnSave(Dictionary<string, object> doc)
        {
            return Audit(doc);
        }

        public static Dictionary<string, object> OnLoad(Dictionary<string, object> doc)
        {
            return doc;
        }

        public static Dictionary<string, object> OnPurge(Dictionary<string, object> doc)
        {
            return doc;
        }

        public static Dictionary<string, object> Audit(Dictionary<string, object> doc)
        {
            doc["audited"] = true;
            return doc;
        }
    }
}
