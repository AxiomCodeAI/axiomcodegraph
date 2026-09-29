package app.rs;

import jakarta.ws.rs.client.Client;
import jakarta.ws.rs.client.ClientBuilder;
import jakarta.ws.rs.client.WebTarget;
import jakarta.ws.rs.core.MediaType;
import org.springframework.web.client.RestTemplate;

class RsClients {
    Client client = ClientBuilder.newClient();
    RestTemplate rest = new RestTemplate();

    // the JAX-RS client API is a send
    String orders() { return client.target("http://shop/orders").request().get(String.class); }
    // … with the path built across the chain, and a builder step before the verb
    String order(String id) {
        return client.target("http://shop").path("orders").path("{id}").request(MediaType.APPLICATION_JSON)
            .accept(MediaType.APPLICATION_JSON).get(String.class);
    }
    String widget(String id) { return rest.getForObject("http://shop/widgets/{id}", String.class, id); }
    String widgetParts(String id) { return rest.getForObject("http://shop/widgets/{id}/parts", String.class, id); }
    String item(String id) { return rest.getForObject("http://shop/items/{id}", String.class, id); }
    String gadget(String id) { return rest.getForObject("http://shop/gadgets/{id}/render", String.class, id); }
}
