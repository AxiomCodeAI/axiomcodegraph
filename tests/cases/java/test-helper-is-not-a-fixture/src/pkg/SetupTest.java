package pkg;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SetupTest {
    @BeforeEach
    void init() { Shared.prepare(); }

    @AfterEach
    void done() { Shared.clean(); }

    @Test
    void first() { }

    @Test
    void second() { }
}
