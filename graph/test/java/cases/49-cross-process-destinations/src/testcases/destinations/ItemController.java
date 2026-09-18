package testcases.destinations;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The server end. The route is the type's prefix plus the method's remainder. */
@RestController
@RequestMapping("/api/items")
public class ItemController {

    @GetMapping("/{id}")
    public String get(@PathVariable String id) {
        return id;
    }

    /** Same path, different verb: only the verb keeps this apart from get(). */
    @PostMapping("/{id}")
    public String replace(@PathVariable String id) {
        return id;
    }

    @GetMapping
    public String list() {
        return "all";
    }
}
