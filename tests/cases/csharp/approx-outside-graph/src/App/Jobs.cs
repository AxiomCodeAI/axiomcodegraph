using System;
using System.Diagnostics;
using System.IO;
using System.Data.SqlClient;

namespace App
{
    public class Jobs
    {
        private const string Seed = "db/seed.sql";

        public void Rebuild()
        {
            Process.Start("bash", "scripts/rebuild.sh --all");
        }

        public void Nightly()
        {
            Rebuild();
        }

        public string LoadSeed()
        {
            return File.ReadAllText(Seed);
        }

        public int CountLines(SqlConnection c)
        {
            var cmd = new SqlCommand("SELECT count(*) FROM order_lines WHERE shipped = 1", c);
            return (int)cmd.ExecuteScalar();
        }

        public void Report(SqlConnection c)
        {
            Console.WriteLine("shipped today: " + CountLines(c));
        }

        public int CheckStock(int n)
        {
            // a stock count below zero used to print "stock went negative" here
            if (n < 0) throw new InvalidOperationException("stock level is negative");
            return n;
        }

        /// <summary>Old notes: the nightly job also ran cleanup.sh, it no longer does.</summary>
        public void Tidy()
        {
        }

        public int Restock(int n)
        {
            return CheckStock(n);
        }
    }
}
