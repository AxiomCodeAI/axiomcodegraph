package app;

import org.springframework.stereotype.Component;

/** CONTROL E: a CLIENT bean. It resolved before this change and must resolve identically after. */
@Component
public class LocalHelper {
    public String help() {
        return "helped";
    }
}
