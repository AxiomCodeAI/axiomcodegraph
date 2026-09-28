package pkg;

import org.junit.jupiter.api.Test;

public class LoadTest {
    @Test
    void loadsOne() {
        new Repo().load(1);
    }
}
