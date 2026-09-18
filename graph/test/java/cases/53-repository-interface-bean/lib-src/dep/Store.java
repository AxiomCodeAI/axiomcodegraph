package dep;

import org.springframework.stereotype.Component;

/** CONTROL: an ordinary library bean, which is a bean because of its stereotype. */
@Component
public class Store {
    public String describe() {
        return "store";
    }
}
