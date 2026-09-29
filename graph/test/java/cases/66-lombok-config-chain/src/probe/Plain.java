package probe;

import lombok.Setter;
import lombok.experimental.Accessors;

/** NEAR MISS: the type's @Accessors(chain = false) wins over lombok.config. */
@Setter
@Accessors(chain = false)
public class Plain {
    private String host;
    private int port;

    public void apply() {
    }
}
