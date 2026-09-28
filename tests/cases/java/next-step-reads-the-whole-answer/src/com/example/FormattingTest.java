package com.example;

import java.util.Locale;
import org.junit.jupiter.api.Test;

class FormattingTest {
    @Test
    void parsesAName() { new NameFormatter().parse("widget", Locale.ROOT); }
    @Test
    void doublesANumber() { new Doubler().twice(3); }
}
