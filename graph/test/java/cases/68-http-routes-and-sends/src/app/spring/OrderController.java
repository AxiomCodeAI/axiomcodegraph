package app.spring;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/")
public class OrderController {
    @PostMapping("/orders/{id}") public String update(@PathVariable String id) { return id; }
    @PostMapping("/shipped") public String shipped() { return ""; }
    @GetMapping("status") public String status() { return ""; }
}
