package testcases.destinations;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

/** The client end, written four different ways, all naming the same route. */
@Component
public class ItemClient {

    private final RestTemplate restTemplate;
    private final String itemPath;

    public ItemClient(RestTemplate restTemplate,
                      @Value("${app.items.item-path}") String itemPath) {
        this.restTemplate = restTemplate;
        this.itemPath = itemPath;
    }

    /** a literal at the call site */
    public String viaLiteral(String id) {
        return restTemplate.getForObject("http://items/api/items/{id}", String.class, id);
    }

    /** a constant declared in another class */
    public String viaConstant(String id) {
        return restTemplate.getForObject(Routes.ITEM, String.class, id);
    }

    /** a field whose value is a configuration key */
    public String viaConfiguredField(String id) {
        return restTemplate.getForObject(itemPath, String.class, id);
    }

    /** a POST to the same path — must reach replace(), not get() */
    public String viaPost(String id) {
        return restTemplate.postForObject("/api/items/{id}", id, String.class);
    }
}
