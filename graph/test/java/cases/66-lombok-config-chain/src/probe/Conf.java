package probe;

import lombok.Setter;

/** #1406: lombok.config makes every setter chain. */
@Setter
public class Conf {
    private String host;
    private int port;

    public void apply() {
    }
}
