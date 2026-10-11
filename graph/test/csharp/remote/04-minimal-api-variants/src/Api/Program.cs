using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Api.Features.Parcels;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// MapMethods: the verbs are argument 1 and the handler argument 2
app.MapMethods("/probe", new[] { "HEAD", "OPTIONS" }, ProbeEndpoints.Probe);
app.MapMethods("/gauges", ["PUT"], ProbeEndpoints.SetGauge);
app.MapMethods("/meters", new[] { HttpMethods.Delete }, ProbeEndpoints.ClearMeter);
var verbs = new List<string> { "PATCH" };
app.MapMethods("/dials", verbs, ProbeEndpoints.TurnDial);
// control: a verb list nothing here can read serves any verb
app.MapMethods("/any", ProbeEndpoints.Verbs(), ProbeEndpoints.Anything);

// a handler held in a local: a lambda and a method group
Func<IResult> listGadgets = () => Results.Ok(Store.All());
app.MapGet("/gadgets", listGadgets);
Func<int, IResult> showGadget = GadgetEndpoints.Show;
app.MapGet("/gadgets/{id}", showGadget);
// control: the same lambda written inline
app.MapGet("/gizmos", () => Results.Ok(Store.All()));
// control: a lambda in a local that is never mapped is no handler
Func<IResult> unused = () => Results.Ok(Store.All());

// a group handed to a helper, by an extension call and by a plain one
app.MapGroup("/api/parcels").MapParcelEndpoints();
var legacy = app.MapGroup("/v1/items");
legacy.MapItemEndpoints();
var current = app.MapGroup("/v2/items").RequireAuthorization();
current.MapItemEndpoints();
ItemAdmin.MapAdmin(app.MapGroup("/admin"));
// control: a local group mapped directly, and a helper called on the app itself
var users = app.MapGroup("/api/users");
users.MapGet("/{id}", GadgetEndpoints.User);
app.MapHealth();

app.Run();
