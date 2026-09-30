package demo.app;

import demo.core.Recorded;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class RecordStore {
    @EventListener
    public void save(Recorded e) { }
}
