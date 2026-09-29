package app;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;

class Widget {}

/** JAX-RS @Produces names a media type: this method defines no bean. */
@Path("/widgets")
class WidgetsResource {
    @GET
    @Produces("application/json")
    Widget current() { return new Widget(); }

    /** Bare, but the file's Produces is the JAX-RS one. */
    @GET
    @Path("/plain")
    @Produces
    Widget plain() { return new Widget(); }
}

class Reports {
    @Inject Widget widget;
    @Inject Gadget gadget;
    @Inject Sprocket sprocket;
    @Inject Thing thing;
}
