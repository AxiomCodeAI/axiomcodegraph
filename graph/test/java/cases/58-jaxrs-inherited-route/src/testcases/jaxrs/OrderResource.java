package testcases.jaxrs;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;

/**
 * The construct. A resource class declares its path once and each handler names
 * only its verb in a sibling annotation, so list() and replaceAll() carry no path
 * of their own and inherit the class's.
 */
@Path("/orders")
public class OrderResource {

    /** Inherited path, GET. */
    @GET
    public String list() {
        return "all";
    }

    /** The same inherited path: only the verb keeps this apart from list(). */
    @PUT
    public String replaceAll(String body) {
        return body;
    }

    /** The control: an explicit method path, which already produced a route. */
    @GET
    @Path("/{id}")
    public String find(@PathParam("id") String id) {
        return id;
    }
}
