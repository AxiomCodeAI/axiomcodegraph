package pkg;
public class Params {
    public String get(String... keys) { return keys.length > 0 ? keys[0] : ""; }
    public String use() { return get("a"); }
}
