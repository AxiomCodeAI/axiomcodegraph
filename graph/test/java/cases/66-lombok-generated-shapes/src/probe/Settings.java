package probe;

import lombok.Data;
import lombok.experimental.Accessors;

/** #1406: chain = true setters return the owner. */
@Data
@Accessors(chain = true)
public class Settings {
    private String host;
    private int port;

    public void apply() {
    }
}
