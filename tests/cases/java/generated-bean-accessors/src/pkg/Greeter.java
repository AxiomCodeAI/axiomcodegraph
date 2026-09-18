package pkg;

public class Greeter {

    public String greet(User u) {
        return "hi " + u.getName();     // a generated getter, no declaration behind it
    }

    public void rename(User u) {
        u.setName("bob");               // and a generated setter
    }
}
