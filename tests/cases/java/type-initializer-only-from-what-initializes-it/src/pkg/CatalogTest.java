package pkg;

import org.junit.Test;

public class CatalogTest {
    @Test
    public void opens() { assert Catalog.open().name(0).equals("a"); }
}
