namespace Books.App;

public class Use
{
    public int Run()
    {
        var l = new Ledger("a", 2020);
        return l.Page(10);
    }
}
