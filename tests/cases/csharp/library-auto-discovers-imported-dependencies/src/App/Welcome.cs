using Example.Greeter;

namespace App;

public static class Welcome
{
    public static string Run(string name)
    {
        return new Greeter().Hello(name).Shout();
    }
}
