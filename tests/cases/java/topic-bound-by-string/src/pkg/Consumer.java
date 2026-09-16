package pkg;
public class Consumer {
    @Listener(id = "groupOne", topics = "topicOne")
    public void listen(String body) { }
}
