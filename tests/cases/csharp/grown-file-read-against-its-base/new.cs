namespace App
{
    public class Service
    {
        private readonly Repo repo;

        private readonly Gateway gateway;

        public Service(
            Repo repo,
            Gateway gateway,
            Clock clock)
        {
            this.repo = repo;
            this.gateway = gateway;
        }

        public int Get(string id)
        {
            return repo.Find(id);
        }

        public async System.Threading.Tasks.Task<int> Pay(int n)
        {
            var total = n;
            return await gateway.Pay(total);
        }
    }

    public class Repo { public int Find(string id) { return 0; } }
    public class Clock { }
    public class Gateway { public System.Threading.Tasks.Task<int> Pay(int n) { return System.Threading.Tasks.Task.FromResult(n); } }
}
