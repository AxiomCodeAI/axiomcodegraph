package torture;

// f09 — BLIND SPOTS, DECLARED. Reflection and dynamic proxies have no statically known target, and
// the honest answer is an explicit unknown rather than a guess or a silent drop. This family exists
// so that "we cannot answer this" is itself pinned: a site that vanishes fails the coverage guard,
// and a site that starts being answered fails the golden.

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ServiceLoader;

public class F09BlindSpots {

    interface Codec { String encode(String s); }
    static class UpperCodec implements Codec { public String encode(String s) { return s.toUpperCase(); } }

    // REFLECTION: the target is a string at runtime
    Object viaReflection(Object target, String name) throws Exception {
        Method m = target.getClass().getMethod(name);
        return m.invoke(target);
    }
    Object viaForName(String cls) throws Exception {
        return Class.forName(cls).getDeclaredConstructor().newInstance();
    }
    // DYNAMIC PROXY: the implementation is generated at runtime
    Codec viaProxy(InvocationHandler h) {
        return (Codec) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[]{Codec.class}, h);
    }
    // SERVICE LOADER: the implementations come from META-INF/services, not from any call site
    String viaServiceLoader() {
        for (Codec c : ServiceLoader.load(Codec.class)) return c.encode("x");
        return "";
    }
    // the control: the same interface, called on a known implementation
    String direct(UpperCodec c) { return c.encode("x"); }
}
