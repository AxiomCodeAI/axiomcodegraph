using System.Net.Http;
using System.Threading.Tasks;

namespace Web.Services
{
    public class DepotClient
    {
        private readonly HttpClient _http;

        public DepotClient(HttpClient http) { _http = http; }

        public Task<HttpResponseMessage> Probe() =>
            _http.SendAsync(new HttpRequestMessage(HttpMethod.Head, "/probe"));

        public Task<HttpResponseMessage> SetGauge(int v) => _http.PutAsync($"/gauges?value={v}", null);

        public Task<HttpResponseMessage> ClearMeter() => _http.DeleteAsync("/meters");

        public Task<HttpResponseMessage> TurnDial() => _http.PatchAsync("/dials", null);

        // the verb does not match: /gauges serves PUT only
        public Task<string> ReadGauge() => _http.GetStringAsync("/gauges");

        public Task<string> Anything() => _http.GetStringAsync("/any");

        public Task<string> Gadgets() => _http.GetStringAsync("/gadgets");

        public Task<string> Gadget(int id) => _http.GetStringAsync($"/gadgets/{id}");

        public Task<string> Parcel(int id) => _http.GetStringAsync($"/api/parcels/{id}");

        public Task<string> OldItem(int id) => _http.GetStringAsync($"/v1/items/{id}");

        public Task<string> NewItem(int id) => _http.GetStringAsync($"/v2/items/{id}");

        public Task<HttpResponseMessage> Purge(int id) => _http.DeleteAsync($"/admin/items/{id}");

        public Task<string> User(int id) => _http.GetStringAsync($"/api/users/{id}");

        public Task<string> Health() => _http.GetStringAsync("/health");
    }
}
