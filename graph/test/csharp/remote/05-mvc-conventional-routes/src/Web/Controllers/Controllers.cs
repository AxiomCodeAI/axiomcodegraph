using Microsoft.AspNetCore.Mvc;

namespace Shop.Web.Controllers;

// conventionally routed: no route attribute on the class or the action
public class WidgetsController : Controller
{
    public IActionResult Details(int id) => View(WidgetRepo.Find(id));

    // a verb attribute with no template keeps the conventional route and narrows the verb
    [HttpPost]
    public IActionResult Save(int id) => Ok(WidgetRepo.Find(id));

    // control: not an action
    [NonAction]
    public object Helper(int id) => WidgetRepo.Find(id);

    // control: not public
    private object Hidden(int id) => WidgetRepo.Find(id);

    // control: static is never an action
    public static object Shared(int id) => WidgetRepo.Find(id);
}

// the pattern's controller default
public class HomeController : Controller
{
    public IActionResult Index() => View();
}

// attribute-routed: conventional routes never reach it
[Route("api/gadgets")]
public class GadgetsController : Controller
{
    [HttpGet("{id}")]
    public IActionResult Details(int id) => Ok(WidgetRepo.Find(id));

    // control: under a class route with no [action] token an unmarked public method is
    // not served, and conventional routes never reach an attribute-routed class
    public object Describe(int id) => WidgetRepo.Find(id);
}

// a class route with an [action] token: each public action is served, any verb
[Route("[controller]/[action]")]
public class OrdersController : Controller
{
    public IActionResult History() => Ok(WidgetRepo.Find(0));

    [HttpGet("{id}")]
    public IActionResult Detail(int id) => Ok(WidgetRepo.Find(id));
}

// a controller whose route is fixed by the second pattern's defaults
public class ReportsController : Controller
{
    public IActionResult Yearly(int year) => Ok(WidgetRepo.Find(year));
}

// control: abstract, and not a controller by name
public abstract class BaseController : Controller
{
    public IActionResult Ping() => Ok();
}

public class WidgetRepo
{
    public static object Find(int id) => id;
    public object Lookup(int id) => id;
}
