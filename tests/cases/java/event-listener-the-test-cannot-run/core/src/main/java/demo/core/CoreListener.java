package demo.core;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class CoreListener {
    @EventListener
    public void onRecorded(Recorded e) { }
}
