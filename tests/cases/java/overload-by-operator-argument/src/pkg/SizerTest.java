package pkg;

import java.util.Collections;
import org.junit.Test;

public class SizerTest {
    @Test
    public void shrinks() { assert new Sizer().shrink(Collections.emptyList()) != null; }

    @Test
    public void rewinds() { new Sizer().rewind(new Bag(1), 1); }

    @Test
    public void marks() { new Sizer().mark(new Bag(1), Collections.emptyList()); }

    @Test
    public void wraps() { assert new Sizer().wrap(new Node()) != null; }
}
