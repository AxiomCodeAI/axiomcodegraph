package com.example;

import java.util.Locale;
import org.springframework.format.Formatter;

public class NameFormatter implements Formatter<String> {
    @Override
    public String print(String name, Locale locale) { return name.trim(); }
    @Override
    public String parse(String text, Locale locale) { return text.toUpperCase(); }
}
