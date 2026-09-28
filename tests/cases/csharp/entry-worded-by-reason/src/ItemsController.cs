using Microsoft.AspNetCore.Mvc;

namespace Shop;

[ApiController]
[Route("items")]
public class ItemsController : ControllerBase
{
    [HttpGet]
    public string Get() => "x";
}
