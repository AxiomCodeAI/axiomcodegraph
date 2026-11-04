// control: a file that declares only namespace P keeps its one correct target
namespace P
{
    public sealed class Alone
    {
        public Models.Report Only() => Models.Report.Make();
    }
}
