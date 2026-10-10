package pkg;

import org.junit.Test;

public class RegistryTest {
    @Test
    public void findsKey() { assert "1".equals(Registry.find("a")); }
}
