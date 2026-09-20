package pkg;
public class Producer {
    private final Bus bus = new Bus();
    public void publish(String what) { bus.send("topicOne", what); }
}
