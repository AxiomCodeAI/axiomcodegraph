package app;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;

@Path("/items")
public class ItemsResource {
    @GET @Path("{id}")
    public String one(@PathParam("id") String id) { return id; }
}
