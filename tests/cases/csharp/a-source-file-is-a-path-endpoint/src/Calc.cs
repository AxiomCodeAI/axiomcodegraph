namespace Calc
{
    public class Adder
    {
        public int Add(int a, int b) { return Twice(a) + b; }
        int Twice(int a) { return a * 2; }
    }
}
