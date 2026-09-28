package probe;

import org.springframework.context.ApplicationEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

// a listener for the framework base type: every published event reaches it, an
// ApplicationEvent subtype (OrderShipped) as itself and a plain object (OrderPlaced)
// wrapped in a PayloadApplicationEvent
@Component
public class AllEvents implements ApplicationListener<ApplicationEvent> {
    @Override
    public void onApplicationEvent(ApplicationEvent event) { }
}
