package app;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/items")
public class ItemController {

    @GetMapping("/{id}")
    public String get(String id) {
        return id;
    }

    @PostMapping("/{id}")
    public String replace(String id) {
        return id;
    }
}
