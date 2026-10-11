package app;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    @PostMapping("/orders/{id}") public String update(@PathVariable String id) { return id; }
    @PostMapping("/shipped") public String shipped() { return ""; }
}
