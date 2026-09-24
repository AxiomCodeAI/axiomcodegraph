using System.Threading.Tasks;
using Grpc.Net.Client;
using Greet;

namespace Client
{
    public class GreeterCaller
    {
        private readonly Greeter.GreeterClient _client;

        public GreeterCaller(Greeter.GreeterClient client) { _client = client; }

        // through an injected client field, the async form
        public async Task<string> Greet(string name)
        {
            var reply = await _client.SayHelloAsync(new HelloRequest { Name = name });
            return reply.Message;
        }

        // through a local built from a channel, the blocking form
        public string GreetBlocking(string name)
        {
            using var channel = GrpcChannel.ForAddress("https://localhost:5001");
            var client = new Greeter.GreeterClient(channel);
            return client.SayHello(new HelloRequest { Name = name }).Message;
        }

        // a server-streaming call
        public void Stream(Greeter.GreeterClient client) => client.SayHellos(new HelloRequest());

        // the other service's rpc of the same name
        public void Admin(Admin.AdminClient admin) => admin.SayHello(new HelloRequest());

        // not gRPC: an HttpClient ends in Client but has no enclosing service segment
        public void Http(System.Net.Http.HttpClient http) => http.GetAsync("/greet");

        // an rpc nothing here serves
        public void Missing(Greeter.GreeterClient client) => client.SayGoodbye(new HelloRequest());
    }
}
