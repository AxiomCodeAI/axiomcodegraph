package pkg;

import org.junit.Test;

public class TableTest {
    @Test
    public void readsTheField() { assert "v".equals(Table.ROWS.get("k")); }
}
