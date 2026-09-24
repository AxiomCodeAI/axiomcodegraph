using System.Net.Http;
using System.Threading.Tasks;

namespace Web.Services
{
    // The base path in a field, written into an interpolation hole, as real clients do.
    public class ReportsClient(HttpClient httpClient)
    {
        private readonly string baseUrl = "api/reports/";

        public Task<string> Daily(int day) => httpClient.GetStringAsync($"{baseUrl}daily/{day}");

        // a trailing separator trimmed off the built URL
        public Task<string> Today() => httpClient.GetStringAsync($"{baseUrl}daily?".TrimEnd('?'));

        // the verb and URL on a request message held in a local
        public Task<HttpResponseMessage> Rebuild()
        {
            var message = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}rebuild");
            return httpClient.SendAsync(message);
        }
    }

    // a declarative client: the interface method is the send
    public interface IOrdersApi
    {
        [Get("/api/orders/{id}")]
        Task<string> GetOrder(int id);
    }
}
