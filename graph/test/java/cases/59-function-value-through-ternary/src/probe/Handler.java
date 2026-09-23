package probe;

// A CLIENT functional interface: the base of a `value` pair is then a method with a row of its own.
interface Handler {
    String handle(String url);
    default Handler twice() { return u -> handle(handle(u)); }
}

class Router {
    private final Handler h;
    Router(boolean strict) { h = strict ? App::getPath : (Handler) App::getPathLoose; }
    String route(String url) { return h.handle(url); }
    Handler composed() { return h.twice(); }          // a default method composes the value; not a base
}
