using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace Store.Web.Pages.Cart;

public class IndexModel : PageModel
{
    public int Count { get; private set; }

    public void OnGet()
    {
        Count = 0;
    }

    public IActionResult OnPost(int itemId)
    {
        Count = itemId;
        return RedirectToPage();
    }

    public void OnPostUpdate(int itemId)
    {
        Count = itemId + 1;
    }
}
