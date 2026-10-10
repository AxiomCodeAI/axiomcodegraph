package pkg;

import org.junit.Test;

public class PromoterTest {
    @Test
    public void promotes() { assert Promoter.promote("a").equals("A"); }
}
