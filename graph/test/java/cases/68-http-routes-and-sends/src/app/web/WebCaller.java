package app.web;

import org.springframework.web.client.RestTemplate;

public class WebCaller {
    RestTemplate rest = new RestTemplate();
    public String counts() { return rest.getForObject("http://localhost:8080/counts", String.class); }
    public String addCount() { return rest.postForObject("http://localhost:8080/counts", null, String.class); }
    public String file(String name) { return rest.getForObject("http://localhost:8080/files/" + name, String.class); }
    public String gauges() { return rest.getForObject("http://localhost:8080/gauges", String.class); }
    // CONTROL: nothing is mapped here, the catch-all servlet does not claim it
    public String other() { return rest.getForObject("http://localhost:8080/elsewhere", String.class); }
}
