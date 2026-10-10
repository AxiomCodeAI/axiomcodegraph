package pkg;

import org.junit.Test;

public class RowTest {
    @Test
    public void reads() { assert "v".equals(Catalog.row("k")); }
}
