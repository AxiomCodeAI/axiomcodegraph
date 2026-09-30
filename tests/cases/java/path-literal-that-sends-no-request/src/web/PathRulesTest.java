package web;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

public class PathRulesTest {
    @Test
    public void keepsExcludedPaths() {
        Settings settings = new Settings();
        settings.setExcludes(new String[]{"/login", "/captcha"});
        assertArrayEquals(new String[]{"/login", "/captcha"}, settings.getExcludes());
    }

    @Test
    public void matchesPatterns() {
        assertTrue(Paths.matches("/users", "/**"));
    }
}
