package pkg;
public class Store {
    public String get(String key) { return key; }
    public String get(int index) { return String.valueOf(index); }
    void use() { get("a"); get(1); }
}
