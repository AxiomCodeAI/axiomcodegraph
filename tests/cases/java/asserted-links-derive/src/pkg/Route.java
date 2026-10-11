package pkg;

import java.lang.reflect.Method;

public class Route {
    static Method find(String name) throws Exception { return Views.class.getMethod(name, Object.class); }

    public static String handle(String name, Object req) throws Exception {
        return ((Response) find(name).invoke(null, req)).render();
    }

    public static String handleLocal(String name, Object req) throws Exception {
        Response resp = (Response) find(name).invoke(null, req);
        String text = resp.render();
        resp.close();
        return text;
    }

    public static String handleVar(String name, Object req) throws Exception {
        var resp = find(name).invoke(null, req);
        return ((Response) resp).render();
    }

    public static Response handleCtor(java.util.function.Supplier<Response> make) {
        Response r = make.get();
        r.close();
        return r;
    }
}
