using System.Collections.Generic;
using System.Linq;

namespace App;

public class Widgets
{
    public List<string> Sorted(List<string> ws)
    {
        return ws.OrderBy(w => w.Length).ToList();
    }
}
