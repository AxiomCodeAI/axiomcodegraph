package pkg;
public class Reader {
    public void push(Object o) { }
    public void push(String s) { }
    public void use(Object o, String s) { push(o); push(s); }
}
