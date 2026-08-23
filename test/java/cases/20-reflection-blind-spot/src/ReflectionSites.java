// PINNED BLIND SPOT — reflection is out of scope BY CONSTRUCTION. No static analysis can name the
// target of Method.invoke without the string value, so the requirement is not that these resolve:
// it is that every site is DECLARED as unknown (or as a library boundary call) and never silently
// dropped. This case exists so that property is asserted rather than assumed — if a future change
// starts inventing targets here, or starts omitting the sites, the golden diff shows it.
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

public class ReflectionSites {

    public String target(String s) { return "hit:" + s; }        // never referenced by name

    String viaMethodInvoke(String cls) throws Exception {
        Class<?> c = Class.forName(cls);
        Method m = c.getMethod("target", String.class);          // name is a STRING
        return (String) m.invoke(c.getDeclaredConstructor().newInstance(), "x");
    }

    Object viaNewInstance(String cls) throws Exception {
        Constructor<?> ctor = Class.forName(cls).getDeclaredConstructor();
        return ctor.newInstance();                               // ctor chosen at runtime
    }

    String viaDynamicName(String which) throws Exception {       // the name is computed
        Method m = ReflectionSites.class.getMethod("target" + which.substring(0, 0), String.class);
        return (String) m.invoke(this, "y");
    }

    public static void main(String[] a) throws Exception {
        ReflectionSites r = new ReflectionSites();
        System.out.println(r.viaMethodInvoke("ReflectionSites"));
        System.out.println(r.viaNewInstance("ReflectionSites"));
        System.out.println(r.viaDynamicName(""));
    }
}
