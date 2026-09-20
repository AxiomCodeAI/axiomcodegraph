namespace Acme
{
    public class Widgets
    {
        private int count;

        public int Total(int extra)
        {
            return count + extra;
        }

        public void Reset()
        {
            count = 0;
        }
    }
}
