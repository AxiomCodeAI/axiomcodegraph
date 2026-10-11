package pkg;

import org.junit.Test;

// control: touches none of the initialized types
public class OtherTest {
    @Test
    public void unrelated() { assert new Cache().get().equals("v"); }
}
