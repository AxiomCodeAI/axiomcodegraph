namespace Acme
{
    public class Widgets
    {
        private int count;

        public int Total(int extra)
        {
            var bonus = 1;
            return count + extra;
        }

        public void Reset()
        {
            count = 0;
        }
    }
}
