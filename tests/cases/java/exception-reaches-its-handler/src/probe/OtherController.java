package probe;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OtherController {
    @GetMapping("/other")
    public String check2(String s) {
        if (s.isEmpty()) throw new LocalProblem();
        return s;
    }
}
