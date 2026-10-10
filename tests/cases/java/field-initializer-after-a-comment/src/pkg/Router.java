package pkg;

public class Router {
    public String route(Handler h, String s) { return h.handle(s); }
}
