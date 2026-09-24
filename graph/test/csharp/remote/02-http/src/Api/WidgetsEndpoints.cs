using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Api.Endpoints
{
    // Minimal APIs: a route group's prefix plus each MapX template, handled by a method group.
    public static class WidgetsEndpoints
    {
        public static void MapWidgets(this IEndpointRouteBuilder app)
        {
            var api = app.MapGroup("api/store");
            api.MapGet("/widgets", GetWidgets);
            api.MapGet("/widgets/{id:int}", GetWidget);
            // a literal sibling of the parameter route: precedence must keep them apart
            api.MapGet("/widgets/featured", GetFeatured);
            api.MapGet("/widgets/{id:int}/parts", GetParts);
            api.MapPost("/widgets", CreateWidget);
            app.MapGet("/ping", Ping);
        }

        public static IResult GetWidgets() => Results.Ok();
        public static IResult GetWidget(int id) => Results.Ok();
        public static IResult GetFeatured() => Results.Ok();
        public static IResult GetParts(int id) => Results.Ok();
        public static IResult CreateWidget() => Results.Ok();
        public static IResult Ping() => Results.Ok();
    }
}
