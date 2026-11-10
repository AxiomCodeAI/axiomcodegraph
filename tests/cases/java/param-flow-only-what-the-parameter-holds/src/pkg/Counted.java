package pkg;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;

// extends an unstaged class: may well be the InputStream a parameter declares
public class Counted extends FilterInputStream {
    public Counted(InputStream in) { super(in); }

    @Override
    public int read() throws IOException { return super.read(); }

    static int first(InputStream in) throws IOException { return in.read(); }
    static int open(InputStream raw) throws IOException { return first(new Counted(raw)); }
}
