package demo.service;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class ItemController {
    @GetMapping("/items/touch")
    public String touch() { return "ok"; }
}
