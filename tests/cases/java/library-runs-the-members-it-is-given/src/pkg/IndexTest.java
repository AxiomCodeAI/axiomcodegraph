package pkg;

import org.junit.Test;

public class IndexTest {
    @Test
    public void countsRepeats() { Index i = new Index(); i.put("a"); assert i.put("a") == 2; }
}
