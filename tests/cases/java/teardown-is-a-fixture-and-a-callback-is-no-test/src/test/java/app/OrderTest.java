package app;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

@ExtendWith(TestResultLogger.class)
class OrderTest {
    @Test
    void opens() { Report.open(); }
}
