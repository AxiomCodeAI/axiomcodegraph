package test;

import app.Callers;
import app.Job;
import org.junit.jupiter.api.Test;

public class CountedTest {
    @Test
    public void counted() {
        new Callers().counted(new Job());
    }
}
