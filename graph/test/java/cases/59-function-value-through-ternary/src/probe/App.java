package probe;

import java.util.function.Function;

// #1206: a function stored in a field reaches the calls made through it, when the stored
// value is chosen on the right-hand side (?:, parentheses, a cast) rather than written directly.
public class App {
    static String getPath(String url) { return url.split("\\?")[0]; }
    static String getPathLoose(String url) { return url; }
    static String viaInit(String url) { return url.trim(); }
    static String viaCast(String url) { return url.toLowerCase(); }
    static String viaOther(String url) { return url.toUpperCase(); }
    static String unrelated(String url) { return url; }

    private final Function<String, String> getPath;
    public final Function<String, String> fetch = url -> this.dispatch(url);
    private final Function<String, String> init = Boolean.getBoolean("x") ? App::viaInit : App::viaInit;
    private Function<String, String> cast;
    Function<String, String> other;
    private final Function<String, String> neverCalled = App::unrelated;   // stored, but nothing calls through it

    public App(Function<String, String> custom, boolean strict) {
        this.getPath = strict ? (custom != null ? custom : App::getPath) : App::getPathLoose;
        cast = (Function<String, String>) App::viaCast;
    }

    String dispatch(String url) { return getPath.apply(url); }
    String viaInitField(String url) { return init.apply(url); }
    String viaCastField(String url) { return cast.apply(url); }
    boolean sameAs(Object o) { return getPath.equals(o); }                 // an Object member: never a base

    static String handle(App app, String url) { return app.fetch.apply(url); }
    static String main2() { return new App(null, true).fetch.apply("/a?b"); }
    static void wire(App app) { app.other = App::viaOther; }               // assigned from outside the class
    static String callOther(App app, String url) { return app.other.apply(url); }
    static String viaParam(Function<String, String> f, String url) { return f.apply(url); }  // a parameter holder
    static String viaArg(String url) { return url.strip(); }
    static String viaCustom(String url) { return url.intern(); }
    static String callers() {
        Function<String, String> local = Boolean.getBoolean("y") ? App::unrelatedLocal : null;  // a local holder
        return viaParam(App::viaArg, "/p") + new App(App::viaCustom, true).dispatch("/c") + local.apply("/l");
    }
    static String unrelatedLocal(String url) { return url; }
}
