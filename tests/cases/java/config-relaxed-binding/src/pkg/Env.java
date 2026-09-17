package pkg;
public class Env {
    @Value("${app.server.prefix-invalid-properties}")
    private String prefix;
    public String labelled(String name) { return prefix + name; }
}
