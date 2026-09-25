namespace App
{
    public class Service
    {
        public int Entry() { return Helper() + 1; }

        int Helper() { return Leaf() * 2; }

        int Leaf() { return 41; }
    }
}
