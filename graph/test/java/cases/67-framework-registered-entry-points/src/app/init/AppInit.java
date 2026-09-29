package app.init;

import jakarta.servlet.ServletContainerInitializer;
import jakarta.servlet.ServletContext;
import java.util.Set;

public class AppInit implements ServletContainerInitializer {
    @Override
    public void onStartup(Set<Class<?>> classes, ServletContext ctx) {
        ctx.addServlet("orders", OrderServlet.class).addMapping("/orders");
        ctx.addFilter("audit", new InitFilter());
        ctx.addListener(StartupListener.class);
    }

    // CONTROL: addListener on a receiver that is not a servlet container
    void wire(EventBus bus) {
        bus.addListener(BusListener.class);
    }
}
