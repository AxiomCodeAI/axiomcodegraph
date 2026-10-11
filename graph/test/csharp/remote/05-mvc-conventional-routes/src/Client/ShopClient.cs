using System.Net.Http;
using System.Threading.Tasks;

namespace Shop.Client;

public class ShopClient
{
    private readonly HttpClient _http;
    public ShopClient(HttpClient http) { _http = http; }

    public Task<string> Widget(int id) => _http.GetStringAsync($"/widgets/details/{id}");
    public Task<HttpResponseMessage> SaveWidget(int id) => _http.PostAsync($"/Widgets/Save/{id}", null);
    public Task<string> Home() => _http.GetStringAsync("/Home/Index");
    public Task<string> Gadget(int id) => _http.GetStringAsync($"/api/gadgets/{id}");
    public Task<string> History() => _http.GetStringAsync("/orders/history");
    public Task<string> Yearly(int year) => _http.GetStringAsync($"/reports/yearly/{year}");
    // controls: not actions, so unserved
    public Task<string> Helper(int id) => _http.GetStringAsync($"/widgets/helper/{id}");
    public Task<string> Describe(int id) => _http.GetStringAsync($"/gadgets/describe/{id}");
    public Task<string> Gadget2(int id) => _http.GetStringAsync($"/gadgets/details/{id}");
}
