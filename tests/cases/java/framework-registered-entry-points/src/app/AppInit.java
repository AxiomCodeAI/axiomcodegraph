package app;

import jakarta.servlet.ServletContainerInitializer;
import jakarta.servlet.ServletContext;
import java.util.Set;

public class AppInit implements ServletContainerInitializer {
    @Override
    public void onStartup(Set<Class<?>> classes, ServletContext ctx) {
        ctx.addServlet("orders", OrderServlet.class).addMapping("/orders");
    }
}
