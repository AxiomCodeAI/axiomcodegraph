package app;
import jakarta.servlet.ServletContext;
public class Init {
    public void onStartup(ServletContext ctx) {
        String n = "reload";
        ctx.addServlet("orders", "app.OrdersServlet");
    }
}
