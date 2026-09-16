package pkg.two;
import java.util.ArrayList;
import java.util.List;
public class Filter {
    static class Header { static Header make(String n) { return new Header(); } String name; }
    List<Header> headers = new ArrayList<>();
    public void allow(String h) { headers.add(Header.make(h)); }
    public Header first() { return Header.make("x"); }
}
