package test;

import app.Callers;
import app.Task;
import org.junit.jupiter.api.Test;

public class OtherTest {
    @Test
    public void other() {
        new Callers().other(new Task());
    }
}
