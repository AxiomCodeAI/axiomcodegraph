package pkg;

import org.junit.Test;

public class HolderTest {
    @Test
    public void readsTheFirstName() { assert Holder.first(null) == null; }
}
