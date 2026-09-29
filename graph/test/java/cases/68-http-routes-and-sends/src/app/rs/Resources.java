package app.rs;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;

// a method path with no leading slash is joined with one
@Path("/items")
class ItemsResource {
    @GET @Path("{id}")
    String one(@PathParam("id") String id) { return id; }
}

// CONTROL: the method path has its own slash
@Path("/orders")
class OrdersResource {
    @GET @Path("/{id}")
    String one(@PathParam("id") String id) { return id; }
    @GET
    String list() { return "[]"; }
}

// a sub-resource locator: @Path and no verb, returning the resource that serves the rest
@Path("/widgets")
class WidgetsResource {
    @Path("/{id}")
    WidgetResource find(@PathParam("id") String id) { return new WidgetResource(id); }
}

class WidgetResource {
    String id;
    WidgetResource(String id) { this.id = id; }
    @GET String details() { return id; }
    @GET @Path("parts") String parts() { return id; }
}

// CONTROL: a verb method returning a type is a handler, not a locator
@Path("/gadgets")
class GadgetsResource {
    @GET @Path("/{id}")
    GadgetView details(@PathParam("id") String id) { return new GadgetView(); }
}

class GadgetView {
    @GET String render() { return ""; }
}
