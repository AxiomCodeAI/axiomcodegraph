package dep;

/**
 * Returned by a dependency @Bean factory method. It carries NO stereotype of its own:
 * it is a bean only because the factory method declares it, which is what SUBJECT C
 * distinguishes from SUBJECT A and B.
 */
public class WidgetCache {
    public String get(String id) {
        return "cached:" + id;
    }
}
