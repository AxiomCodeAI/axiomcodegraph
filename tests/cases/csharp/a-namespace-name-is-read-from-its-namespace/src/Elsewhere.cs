// control: from a namespace with no Results or Reflection under it, the same names reach nothing in Shop
namespace Billing
{
    using Results;

    public class Ledger
    {
        public void Post()
        {
            var failure = new Failure("y");
            failure.Describe();
            var info = Reflection.Info.Create("ledger");
        }
    }
}
