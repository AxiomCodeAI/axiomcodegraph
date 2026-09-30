package demo.core;

import org.springframework.context.ApplicationEventPublisher;

public class Recorder {
    private final ApplicationEventPublisher publisher;

    public Recorder(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    public void record(String what) { publisher.publishEvent(new Recorded(what)); }
}
