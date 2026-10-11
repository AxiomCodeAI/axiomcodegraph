namespace App
{
    public class Callers
    {
        public int Plain(Job j)
        {
            return j.Run();
        }

        public int Counted(Job j)
        {
            return j.Run(3);
        }

        public int Other(Task t)
        {
            return t.Run() + t.Unique();
        }
    }
}
