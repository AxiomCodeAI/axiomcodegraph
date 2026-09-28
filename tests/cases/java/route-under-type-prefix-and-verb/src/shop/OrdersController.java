package shop;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
public class OrdersController {
    @GetMapping
    public String list() {
        return "[]";
    }

    @PostMapping
    public String create() {
        return "{}";
    }

    @PostMapping("lines")
    public String addLine() {
        return "{}";
    }
}
