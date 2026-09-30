package demo.app;

import demo.core.Recorder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

@ExtendWith(MockitoExtension.class)
public class MockedPublisherTest {
    @Mock
    private ApplicationEventPublisher publisher;

    @Test
    public void recordsWithAMock() {
        new Recorder(publisher).record("z");
    }
}
