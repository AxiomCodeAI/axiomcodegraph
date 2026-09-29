package app;

import javax.ws.rs.*;

class Thing {}

/** JAX-RS imported on demand: a bare @Produces here is still not CDI's. */
@Path("/things")
class ThingResource {
    @GET
    @Produces
    Thing thing() { return new Thing(); }
}
