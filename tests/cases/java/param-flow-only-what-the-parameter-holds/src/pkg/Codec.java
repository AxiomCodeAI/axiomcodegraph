package pkg;

import java.io.Reader;
import java.io.StringReader;
import java.lang.reflect.Type;

// overloads that call each other: each one's argument used to flow into every sibling's `json`
public class Codec {
    public <T> T from(String json, Type t) { return from(json, Tok.get(t)); }
    public <T> T from(String json, Tok<T> t) { return from(new StringReader(json), t); }
    public <T> T from(Reader json, Tok<T> t) { return from(Parser.parse(json), t); }
    public <T> T from(El json, Type t) { return from(json, Tok.get(t)); }
    public <T> T from(El json, Tok<T> t) { return null; }

    // control: a subtype argument still flows into the parameter it fits
    public <T> T leaf(Leaf json, Type t) { return from(json, Tok.get(t)); }
}
