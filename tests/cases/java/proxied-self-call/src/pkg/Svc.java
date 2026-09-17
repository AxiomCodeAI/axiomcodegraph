package pkg;
public class Svc {
    public String load(String k) { return k; }
    public String both(String k) { return load(k); }
}
