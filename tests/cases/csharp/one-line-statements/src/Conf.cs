using System.Collections.Generic;

namespace A
{
    public class Conf
    {
        static readonly Dictionary<string, int> Settings = new Dictionary<string, int>
        {
            ["retries"] = 3,
            ["timeout"] = 10,
        };
        static readonly int Limit = 1;

        public int Get()
        {
            return Settings["retries"] + Limit;
        }
    }
}
