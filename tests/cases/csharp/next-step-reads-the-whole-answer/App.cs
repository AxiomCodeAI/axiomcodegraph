using System;
using Microsoft.AspNetCore.Mvc;

namespace Shop
{
    public class WidgetController : ControllerBase
    {
        [HttpGet("widgets")]
        public IActionResult Get() { return Ok(); }
    }

    public class Orphan { public void X() { } }

    public class Service
    {
        public void Place(string id) { Console.WriteLine(id); }
        public void Lonely() { }
    }

    public class Listener { public void On(string id) { } }
}
