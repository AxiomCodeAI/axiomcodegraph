using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers
{
    // Attribute routing: the class route, with the [controller] token, plus each method's.
    [ApiController]
    [Route("api/[controller]")]
    public class OrdersController : ControllerBase
    {
        [HttpGet]
        public IActionResult List() => Ok();

        [HttpGet("{id:int}")]
        public IActionResult Get(int id) => Ok();

        [HttpPost]
        public IActionResult Create(OrderDto dto) => Ok();

        [HttpDelete("{id}")]
        public IActionResult Delete(int id) => Ok();

        // an absolute template ignores the class route
        [HttpGet("/health")]
        public IActionResult Health() => Ok();

        // not an action: no route attribute and not public
        private void Audit() { }
    }

    public class OrderDto { public int Id { get; set; } }
}
