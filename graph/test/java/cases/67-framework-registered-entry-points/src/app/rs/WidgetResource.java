package app.rs;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.HeaderParam;

@Path("widgets")
public class WidgetResource {
    @GET
    public String list(@QueryParam("size") Size size, @HeaderParam("color") Color color) {
        return "n=" + size.n + color.name;
    }

    public String weigh(Weight w) { return ""; }
}
