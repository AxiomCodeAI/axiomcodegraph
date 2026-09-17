package pkg;
public class Client {
    private Svc svc;
    public String use(String k) { return svc.load(k); }
}
