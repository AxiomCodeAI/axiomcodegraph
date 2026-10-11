package app;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;

abstract class BaseTest {
    @BeforeEach
    void wind() { Clock.start(); }

    @AfterEach
    void rewind() { Clock.reset(); }

    @AfterAll
    static void down() { Registry.shutdown(); }
}
