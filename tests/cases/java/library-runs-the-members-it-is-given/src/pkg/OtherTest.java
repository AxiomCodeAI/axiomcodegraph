package pkg;

import org.junit.Test;

// control: constructs none of the types above
public class OtherTest {
    @Test
    public void unrelated() { assert "x".length() == 1; }
}
