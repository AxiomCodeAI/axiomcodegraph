package web;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/logs")
public class LogController {
    @DeleteMapping("/{ids}")
    public int remove(String ids) { return 1; }

    @GetMapping("/list")
    public String list() { return "[]"; }
}
