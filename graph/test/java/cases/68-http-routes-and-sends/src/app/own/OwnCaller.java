package app.own;

public class OwnCaller {
    Client client = new Client();
    String fetch() { return client.target("http://shop/orders").request().get(String.class); }
}
