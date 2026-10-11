package test;

import app.Callers;
import app.Job;
import org.junit.jupiter.api.Test;

public class PlainTest {
    @Test
    public void plain() {
        new Callers().plain(new Job());
    }
}
