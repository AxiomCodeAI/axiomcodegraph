using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Api.Endpoints
{
    public static class ReportsEndpoints
    {
        public static void MapReports(this IEndpointRouteBuilder app)
        {
            // a group reached through a fluent call on MapGroup
            var reports = app.MapGroup("/api/reports").RequireAuthorization();
            // an optional parameter: the `?` is inside braces, not a query string
            reports.MapGet("/daily/{day:int?}", Daily);
            // a lambda handler is its own method
            reports.MapPost("/rebuild", () => Results.Accepted());
        }

        public static IResult Daily(int? day) => Results.Ok();
    }
}
