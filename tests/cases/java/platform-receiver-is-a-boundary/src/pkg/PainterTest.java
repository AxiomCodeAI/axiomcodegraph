package pkg;

import org.junit.Test;

public class PainterTest {
    @Test
    public void paints() { assert new Painter().paint() > 0; }

    @Test
    public void clamps() { assert new Painter().clamp(-1) == 0; }
}
