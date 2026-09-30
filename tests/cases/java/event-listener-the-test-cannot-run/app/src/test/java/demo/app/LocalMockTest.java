package demo.app;

import static org.mockito.Mockito.mock;

import demo.core.Recorder;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

public class LocalMockTest {
    @Test
    public void recordsWithALocalMock() {
        new Recorder(mock(ApplicationEventPublisher.class)).record("w");
    }
}
