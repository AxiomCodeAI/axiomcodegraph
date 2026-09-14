package dep;

public class Event {
    private final String name;
    public Event(String name) { this.name = name; }
    public String name() { return name; }
    public Event derive() { return new Event(name + "'"); }
}
