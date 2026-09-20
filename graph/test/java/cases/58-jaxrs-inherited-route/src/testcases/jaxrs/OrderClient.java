package testcases.jaxrs;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/** The client end. Each call names a path and a verb the resource must be matched on. */
@Component
public class OrderClient {

    private final RestTemplate restTemplate;

    public OrderClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    /** GET on the inherited path: must reach list(), not replaceAll(). */
    public String list() {
        return restTemplate.getForObject("/orders", String.class);
    }

    /** PUT on the same inherited path: must reach replaceAll(), not list(). */
    public void replaceAll(String body) {
        restTemplate.put("/orders", body);
    }

    /** GET on the explicit method path: the control that already resolved. */
    public String find(String id) {
        return restTemplate.getForObject("/orders/{id}", String.class, id);
    }
}
