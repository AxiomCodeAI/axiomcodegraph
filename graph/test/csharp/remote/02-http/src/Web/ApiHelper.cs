using System.Net.Http;
using System.Threading.Tasks;

namespace Web.Services
{
    // The wrapper real clients send through: callers pass the path, and the base address
    // comes from configuration at run time, glued to the path with no separator.
    public class ApiHelper
    {
        private readonly HttpClient _httpClient;
        private readonly string _root;

        public ApiHelper(HttpClient httpClient, string root) { _httpClient = httpClient; _root = root; }

        public Task<HttpResponseMessage> Fetch(string path) => _httpClient.GetAsync($"{_root}{path}");

        public Task<HttpResponseMessage> Drop(string path, int id) => _httpClient.DeleteAsync($"{_root}{path}/{id}");
    }

    public class OrdersPage
    {
        private readonly ApiHelper _http;
        public OrdersPage(ApiHelper http) { _http = http; }

        // the edge starts HERE, at the caller that wrote the route
        public Task Load() => _http.Fetch("api/orders");
        public Task Show(int id) => _http.Fetch($"api/orders/{id}");
        public Task Remove(int id) => _http.Drop("api/orders", id);
    }
}
