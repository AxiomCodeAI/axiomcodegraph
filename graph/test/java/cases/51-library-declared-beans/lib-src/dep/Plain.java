package dep;

/**
 * CONTROL D: a dependency type with NO stereotype and no factory method. It must NOT
 * become a bean, and an injection point declared as `Plain` must stay unsatisfied. This
 * is what proves the change reads the annotation rather than treating every staged
 * library type as injectable.
 */
public class Plain {
    public String run() {
        return "plain";
    }
}
