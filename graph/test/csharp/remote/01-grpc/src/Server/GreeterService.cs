using System.Threading.Tasks;
using Grpc.Core;
using Greet;

namespace Server.Services
{
    // The server end: a class deriving from the generated <Service>.<Service>Base.
    // Grpc.Tools generates Greeter.GreeterBase into obj/, so it is never in the source tree.
    public class GreeterService : Greeter.GreeterBase
    {
        public override Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context)
            => Task.FromResult(new HelloReply { Message = "Hello " + request.Name });

        public override async Task SayHellos(HelloRequest request, IServerStreamWriter<HelloReply> stream, ServerCallContext context)
            => await stream.WriteAsync(new HelloReply());

        // an rpc no client in this tree calls
        public override Task<HelloReply> SayGoodnight(HelloRequest request, ServerCallContext context)
            => Task.FromResult(new HelloReply());

        // not an rpc: a helper on the service class
        public string Format(string name) => name;
    }

    // not gRPC: an override on an ordinary framework base whose name also ends in Base
    public class HealthController : Microsoft.AspNetCore.Mvc.ControllerBase
    {
        public override string ToString() => "health";
    }

    // a second service with an rpc of the same name, which must not be confused with Greeter's
    public class AdminService : Admin.AdminBase
    {
        public override Task<HelloReply> SayHello(HelloRequest request, ServerCallContext context)
            => Task.FromResult(new HelloReply());
    }
}
