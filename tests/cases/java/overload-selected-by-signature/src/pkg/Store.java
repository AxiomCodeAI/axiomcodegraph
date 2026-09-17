package pkg;
public class Store {
    public void put(Object o) { }
    public void put(String s) { }
    public void onlyObject(Object o) { put(o); }
    public void onlyString(String s) { put(s); }
}
