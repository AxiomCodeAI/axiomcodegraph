package test;

import app.ItemClient;
import org.junit.jupiter.api.Test;

public class ItemClientTest {

    @Test
    void updates() {
        new ItemClient().update("7");
    }
}
