package pkg;
public class Env {
    @RequestMapping("/{name}/{profiles}/{label:.*}")
    public String labelled(String name, String profiles, String label) { return name; }

    public String plain(String name) { return name; }
}
