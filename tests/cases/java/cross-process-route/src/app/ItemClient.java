package app;

import org.springframework.web.client.RestTemplate;

public class ItemClient {

    private final RestTemplate restTemplate = new RestTemplate();

    /** a POST to the route: reaches replace(), never get() */
    public String update(String id) {
        return restTemplate.postForObject("http://items/api/items/{id}", id, String.class);
    }
}
