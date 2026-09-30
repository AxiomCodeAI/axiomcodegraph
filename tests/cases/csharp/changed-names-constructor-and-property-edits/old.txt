namespace Books.App;

public class Ledger
{
    private readonly string _owner;

    public Ledger(string owner, int year)
    {
        _owner = owner;
    }

    public int Page(int size, int page = 1)
    {
        return size * page;
    }
}
