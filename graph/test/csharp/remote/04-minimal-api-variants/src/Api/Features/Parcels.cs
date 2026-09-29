using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Api.Features.Parcels
{
    public static class ParcelEndpoints
    {
        // the one of two same-named helpers that Program.cs has in scope
        public static RouteGroupBuilder MapParcelEndpoints(this RouteGroupBuilder group)
        {
            group.MapGet("/{id}", GetParcel);
            return group;
        }

        public static IResult GetParcel(int id) => Results.Ok(id);
    }
}

namespace Api.Features.Crates
{
    public static class CrateEndpoints
    {
        // same name, another namespace, never in scope where it would be called:
        // it is not bound, and its route keeps the bare template
        public static RouteGroupBuilder MapParcelEndpoints(this RouteGroupBuilder group)
        {
            group.MapGet("/crates/{id}", GetCrate);
            return group;
        }

        public static IResult GetCrate(int id) => Results.Ok(id);
    }
}
