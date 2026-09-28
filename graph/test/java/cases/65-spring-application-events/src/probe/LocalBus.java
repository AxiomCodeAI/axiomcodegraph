package probe;

import org.springframework.stereotype.Component;

// control: a method called publishEvent on a project type; a call to it is an ordinary call
@Component
public class LocalBus {
    public void publishEvent(Object event) { }
}
