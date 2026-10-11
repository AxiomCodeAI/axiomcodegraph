using System.Collections.Generic;
using System.Threading.Tasks;

namespace App
{
    public class Response
    {
        public string Render() => "ok";
        public void Close() { }
    }

    public class Builder
    {
        public Builder Step() => this;
        public Response Done() => new Response();
    }

    public static class Views
    {
        public static Response MakeResponse(object req) => new Response();
        public static Response? MaybeResponse(object req) => new Response();
        public static Builder MakeBuilder(object req) => new Builder();
        public static async Task<Response> FetchResponse(object req) { await Task.Yield(); return new Response(); }
        public static IEnumerable<Response> Many(object req) => new List<Response> { new Response() };
        public static void Untyped(object req) { }
    }
}
