using System.Threading.Tasks;
using Greet;
using RemoteGreeter = Greet.Greeter.GreeterClient;

namespace Client
{
    // The client type through a using alias, injected through a primary constructor:
    // the alias carries none of the generated shape, so it is expanded to its target.
    public class AliasedCaller(RemoteGreeter greeter)
    {
        public async Task Hello() => await greeter.SayHelloAsync(new HelloRequest());
    }
}
