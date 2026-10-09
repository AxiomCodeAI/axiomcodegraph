package pkg;

import org.junit.Test;

public class ClientTest {
    @Test
    public void readsThroughTheCache() { assert "v".equals(new Client().read()); }
}
