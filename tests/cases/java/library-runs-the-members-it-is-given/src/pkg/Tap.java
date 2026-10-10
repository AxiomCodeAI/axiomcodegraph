package pkg;

import kit.Source;

public class Tap implements Source {
    @Override
    public String next() { return "drip"; }
}
