package app;
import java.text.DateFormat;
import java.text.ParseException;
import java.text.ParsePosition;
import java.util.Date;

public class Reader {
    private final DateFormat fmt = new StrictFormat();
    private final StrictFormat strict = new StrictFormat();
    public Date overrideViaLibraryType(String t) { return fmt.parse(t, new ParsePosition(0)); }
    public Date overrideViaClientType(String t)  { return strict.parse(t, new ParsePosition(0)); }
    public Date inheritedViaLibraryType(String t) throws ParseException { return fmt.parse(t); }
    public Date inheritedViaClientType(String t)  throws ParseException { return strict.parse(t); }
}
