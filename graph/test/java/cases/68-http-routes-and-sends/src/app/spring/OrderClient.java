package app.spring;

import org.springframework.web.client.RestTemplate;

public class OrderClient {
    private final RestTemplate rest = new RestTemplate();

    // the body literal is not a destination
    public void markShipped(String id) { rest.postForObject("/api/orders/" + id, "shipped", String.class); }
    // CONTROL: the same call with the body in a parameter
    public void markPaid(String id, String status) { rest.postForObject("/api/orders/" + id, status, String.class); }
    public String status() { return rest.getForObject("/api/status", String.class); }
}
