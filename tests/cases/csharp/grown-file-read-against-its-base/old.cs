namespace App
{
    public class Service
    {
        private readonly Repo repo;

        public Service(
            Repo repo,
            Clock clock)
        {
            this.repo = repo;
        }

        public int Get(string id)
        {
            return repo.Find(id);
        }
    }
}
