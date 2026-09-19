package testcases.jaxrs;

import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

/**
 * The control, in the same case. The same two shapes written the way that already
 * worked: the verb lives in the mapping annotation rather than a sibling, and a
 * bare @GetMapping already inherited the type's prefix. Nothing here may move.
 */
@RestController
@RequestMapping("/widgets")
class WidgetController {

    @GetMapping
    public String list() {
        return "all";
    }

    @PutMapping
    public String replaceAll(String body) {
        return body;
    }
}

@Component
class WidgetClient {

    private final RestTemplate restTemplate;

    WidgetClient(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public String list() {
        return restTemplate.getForObject("/widgets", String.class);
    }

    public void replaceAll(String body) {
        restTemplate.put("/widgets", body);
    }
}
