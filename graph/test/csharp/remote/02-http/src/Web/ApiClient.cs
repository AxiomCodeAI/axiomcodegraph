using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;

namespace Web.Services
{
    public class ApiClient
    {
        private readonly HttpClient _http;
        private readonly string _base = "http://api";

        public ApiClient(HttpClient http) { _http = http; }

        // a literal path
        public Task<string> Orders() => _http.GetStringAsync("api/orders");

        // an interpolated path with a hole where the route has a parameter
        public Task<HttpResponseMessage> Order(int id) => _http.GetAsync($"api/orders/{id}");

        // a verb other than GET, and a leading slash
        public Task<HttpResponseMessage> Create(object dto) => _http.PostAsJsonAsync("/api/orders", dto);

        // a base address in front, built into a local
        public Task<HttpResponseMessage> Remove(int id)
        {
            var url = $"{_base}/api/orders/{id}";
            return _http.DeleteAsync(url);
        }

        // a concatenation, and a query string
        public Task<string> Items(int page) => _http.GetStringAsync("api/store/widgets" + "?page=" + page);

        public Task<HttpResponseMessage> Item(int id) => _http.GetAsync("api/store/widgets/" + id);

        // the verb does not match: nothing serves PUT on this path
        public Task<HttpResponseMessage> Replace(object dto) => _http.PutAsJsonAsync("api/store/widgets", dto);

        // the literal sibling route, by name: precedence keeps it off {id:int}
        public Task<string> Featured() => _http.GetStringAsync("api/store/widgets/featured");

        // a literal where the route has a parameter: route_shape, the only candidate
        public Task<string> Parts() => _http.GetStringAsync("api/store/widgets/7/parts");

        // a whole URL in the leading hole followed by a query: not a base address
        public Task<string> Paged(string url) => _http.GetStringAsync($"{url}&page=2");

        // a path nothing here serves
        public Task<string> Missing() => _http.GetStringAsync("api/nowhere");

        // a URL the engine cannot read: built from a parameter alone
        public Task<string> Dynamic(string path) => _http.GetStringAsync(path);
    }
}
