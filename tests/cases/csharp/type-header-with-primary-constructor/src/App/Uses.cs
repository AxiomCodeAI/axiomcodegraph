namespace Depot.App;

public class Mailer
{
    private readonly MailSettings _settings;

    public Mailer(MailSettings settings)
    {
        _settings = settings;
    }

    public string Host() => _settings.Host;
}

public class Orders
{
    public CancelOrder Cancel(int n) => new CancelOrder(n);

    public Plain Make() => new Plain(1);
}
