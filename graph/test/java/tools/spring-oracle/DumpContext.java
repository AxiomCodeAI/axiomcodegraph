package oracle;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.*;

/**
 * GROUND TRUTH from Spring itself — not from this repo's engine.
 *
 * Boots the scanned package in a real AnnotationConfigApplicationContext and prints
 * what the CONTAINER decided, in a flat TSV the comparator reads:
 *
 *   BEAN   <beanName>                        <runtimeClass>
 *   INJECT <declClass>#<field>               <beanName>   <runtimeClass>
 *   CTORP  <declClass>#arg<i>                <beanName>   <runtimeClass>
 *   FACTP  <declClass>#<method>#arg<i>       <beanName>   <runtimeClass>
 *   VALUE  <declClass>#<field>               <@Value string>
 *
 * CONSTRUCTOR vs FACTORY. A bean built by a @Bean method was NOT constructor-autowired
 * — the method body called `new` itself — so inferring constructor injection from its
 * runtime class invents an injection point the container never resolved. Beans with a
 * resolved factory method therefore report FACTP (the method's parameters, which Spring
 * really does resolve) and never CTORP.
 *
 * Spring's own infrastructure beans (org.springframework.context.annotation.internal*)
 * are excluded: they are the container, not the program under analysis, and scoring
 * them would drown the signal.
 *
 * usage: java oracle.DumpContext <package-to-scan> [key=value ...]
 */
public class DumpContext {

    public static void main(String[] args) throws Exception {
        String pkg = args[0];
        Map<String, Object> props = new LinkedHashMap<>();
        for (int i = 1; i < args.length; i++) {
            int eq = args[i].indexOf('=');
            props.put(args[i].substring(0, eq), args[i].substring(eq + 1));
        }

        AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext();
        ctx.getEnvironment().getPropertySources()
           .addFirst(new MapPropertySource("oracle", props));
        ctx.scan(pkg);
        ctx.refresh();

        List<String> names = new ArrayList<>();
        for (String n : ctx.getBeanDefinitionNames()) {
            if (n.startsWith("org.springframework")) continue;   // container internals
            names.add(n);
        }

        // name -> instance, for resolving an injected object BACK to its bean name
        Map<String, Object> instances = new LinkedHashMap<>();
        for (String n : names) {
            try { instances.put(n, ctx.getBean(n)); } catch (Exception ignored) { }
        }

        List<String> out = new ArrayList<>();
        for (Map.Entry<String, Object> e : instances.entrySet()) {
            Class<?> c = e.getValue().getClass();
            out.add("BEAN\t" + e.getKey() + "\t" + c.getName());
        }

        for (Map.Entry<String, Object> e : instances.entrySet()) {
            Object bean = e.getValue();
            Class<?> c = bean.getClass();
            for (Field f : c.getDeclaredFields()) {
                if (f.isAnnotationPresent(Value.class)) {
                    out.add("VALUE\t" + c.getName() + "#" + f.getName()
                            + "\t" + f.getAnnotation(Value.class).value());
                }
                if (!f.isAnnotationPresent(Autowired.class)
                        && !f.isAnnotationPresent(Qualifier.class)) continue;
                f.setAccessible(true);
                Object v = f.get(bean);
                if (v == null) continue;
                out.add("INJECT\t" + c.getName() + "#" + f.getName()
                        + "\t" + nameOf(instances, v) + "\t" + v.getClass().getName());
            }
            Method factory = factoryMethodOf(ctx, e.getKey());
            if (factory != null) {
                // Built by a @Bean method: the METHOD's parameters are what Spring
                // resolved from the context. Its runtime class's constructor is not.
                Parameter[] ps = factory.getParameters();
                for (int i = 0; i < ps.length; i++) {
                    Object v = byType(instances, ps[i].getType());
                    if (v == null) continue;
                    out.add("FACTP\t" + factory.getDeclaringClass().getName()
                            + "#" + factory.getName() + "#arg" + i
                            + "\t" + nameOf(instances, v) + "\t" + v.getClass().getName());
                }
                continue;
            }
            // Constructor injection: Spring 4.3+ autowires a sole constructor with
            // no annotation at all, so the parameter list IS the injection point set.
            // Parameter NAMES are arg0/arg1 unless compiled with -parameters, so the
            // position is the stable key on both sides.
            Constructor<?>[] ctors = c.getDeclaredConstructors();
            if (ctors.length == 1 && ctors[0].getParameterCount() > 0) {
                Parameter[] ps = ctors[0].getParameters();
                for (int i = 0; i < ps.length; i++) {
                    Object v = byType(instances, ps[i].getType());
                    if (v == null) continue;
                    out.add("CTORP\t" + c.getName() + "#arg" + i
                            + "\t" + nameOf(instances, v) + "\t" + v.getClass().getName());
                }
            }
        }

        ctx.close();
        Collections.sort(out);
        out.forEach(System.out::println);
    }

    /** The @Bean method that produced this bean, or null if it was constructed. */
    private static Method factoryMethodOf(AnnotationConfigApplicationContext ctx, String name) {
        try {
            BeanDefinition bd = ctx.getBeanFactory().getMergedBeanDefinition(name);
            if (bd instanceof RootBeanDefinition rbd) return rbd.getResolvedFactoryMethod();
        } catch (Exception ignored) { }
        return null;
    }

    private static String nameOf(Map<String, Object> instances, Object v) {
        for (Map.Entry<String, Object> e : instances.entrySet()) {
            if (e.getValue() == v) return e.getKey();
        }
        return "?";
    }

    /** The single bean assignable to this parameter type, or null if 0 or >1. */
    private static Object byType(Map<String, Object> instances, Class<?> t) {
        Object hit = null;
        for (Object v : instances.values()) {
            if (t.isInstance(v)) {
                if (hit != null) return null;
                hit = v;
            }
        }
        return hit;
    }
}
