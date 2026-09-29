package app.settings;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class Greeter {
    private int timeout;
    private String mode;
    private String name;
    private static String home;

    @Value("${greet.retries}")                  // control: on a field
    private int retries;

    @Value("${greet.timeout}")                  // the construct: on a setter
    public void setTimeout(int t) { this.timeout = t; }

    @Value("${greet.home}")                     // the construct, storing into a static field
    public void setHome(String h) { Greeter.home = h; }

    @Value("plain")                             // near miss: no placeholder, no key
    public void setMode(String m) { this.mode = m; }

    @Value("${greet.absent}")                   // declared unknown: a key in no config file
    public void setAbsent(String a) { }

    public void setName(String n) { this.name = n; }   // near miss: not injected

    public int timeout() { return timeout; }
    public int retries() { return retries; }
    public String mode() { return mode; }
    public String name() { return name; }
    public static String home() { return home; }
    public String describe() { return name() + ":" + timeout(); }
}
