using Microsoft.AspNetCore.Mvc;

namespace App.Web.ViewComponents;

// same simple name as App.Entities.Basket, extends a framework base
public class Basket : ViewComponent
{
    public IViewComponentResult Invoke() => Content("basket");
}

// the only class of its name, extends a framework base
public class Header : ViewComponent
{
    public IViewComponentResult Invoke() => Content("header");
}

// one class in two parts: the base is written on this part only
public partial class Footer : ViewComponent
{
    public IViewComponentResult Invoke() => Content("footer");
}
