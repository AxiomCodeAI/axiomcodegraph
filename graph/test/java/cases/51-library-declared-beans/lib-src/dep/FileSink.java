package dep;

import org.springframework.stereotype.Component;

/** CONTROL F, arm one. */
@Component
public class FileSink implements Sink {
    @Override
    public void write(String line) {
    }
}
