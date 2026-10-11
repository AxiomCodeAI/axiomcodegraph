namespace Shop
{
    public class Machine
    {
        // `Reflection` is Shop.Reflection: a qualified name is read from the namespace it is written in
        public void Guard() { var info = Reflection.Info.Create("guard"); }
    }
}

namespace Shop.Orders
{
    public class Desk
    {
        // from a namespace nested deeper, the enclosing Shop still supplies `Reflection`
        public void Check() { var info = Reflection.Info.Create("desk"); }
    }
}
