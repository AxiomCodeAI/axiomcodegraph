package pkg;

import org.junit.Test;

public class ConfigTest {
    @Test
    public void readsTheField() { assert new Config().retries == 3; }
}
