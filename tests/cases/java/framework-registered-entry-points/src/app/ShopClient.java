package app;

import org.springframework.web.client.RestTemplate;

public class ShopClient {
    private final RestTemplate rest = new RestTemplate();

    public String item(String id) { return rest.getForObject("http://shop/items/{id}", String.class, id); }
    public void markShipped(String id) { rest.postForObject("/orders/" + id, "shipped", String.class); }
}
