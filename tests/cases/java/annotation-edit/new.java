package pkg;
public class Env {
    @Cacheable("environments")
    @RequestMapping("/{name}/{profiles}/{label:.*}")
    public String labelled(String name, String profiles, String label) { return name; }

    @Async
    public String plain(String name) { return name; }
}
