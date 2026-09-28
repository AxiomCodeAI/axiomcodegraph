package probe;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

// a listener for Object receives every published event, whatever its type
@Component
public class EverythingLog {
    @EventListener
    public void any(Object event) { }
}
