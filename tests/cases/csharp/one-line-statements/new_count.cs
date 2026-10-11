namespace A
{
    public class Box
    {
        private int size = 1, weight = 2;
        private string label = "b"; private int count = 9;
        const int Limit = 3; const string Name = "x";

        public int Run(int k)
        {
            int con = k + 1; int dr = k + 2; int rc = k + 3;
            return con + dr + rc + size + weight + count + Limit + label.Length + Name.Length;
        }
    }
}
