import java.net.URI;
import java.util.UUID;

public class Caps {
    static class JSON {                       // client all-caps type with a static method
        static Object parseObject(String s) { return s; }
    }
    void f() {
        URI u = URI.create("http://x");       // lib all-caps type, static call
        String id = UUID.randomUUID().toString();
        Object o = JSON.parseObject("{}");    // client all-caps type, static call
        String p = u.getPath();
    }
}
