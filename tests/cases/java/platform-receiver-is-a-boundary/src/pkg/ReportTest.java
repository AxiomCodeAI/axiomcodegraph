package pkg;

import org.junit.Test;

public class ReportTest {
    @Test
    public void prints() { assert new Report("a").toString().endsWith("a"); }
}
