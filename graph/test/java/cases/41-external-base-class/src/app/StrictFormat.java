package app;
import java.text.DateFormat;
import java.text.FieldPosition;
import java.text.ParsePosition;
import java.util.Date;

public class StrictFormat extends DateFormat {
    @Override public Date parse(String text, ParsePosition pos) { return parseStrict(text, pos); }
    Date parseStrict(String text, ParsePosition pos) { pos.setIndex(text.length()); return new Date(0L); }
    @Override public StringBuffer format(Date date, StringBuffer to, FieldPosition pos) { return to.append(date.getTime()); }
    // the inherited platform method through the implicit receiver
    Date viaImplicitThis(String text) throws java.text.ParseException { return parse(text); }
}
