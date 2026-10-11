package probe;

import java.util.Optional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    private final Optional<String> none = Optional.empty();

    @GetMapping("/orders")
    public String get(String id) {
        if (id == null) throw new OrderNotFound();
        return id;
    }

    @GetMapping("/express")
    public String getExpress() {
        return none.orElseThrow(ExpressOrderNotFound::new);
    }

    @GetMapping("/pay")
    public String pay(int cents) {
        if (cents < 0) throw new PaymentFailed();
        return "ok";
    }

    @GetMapping("/check")
    public String check(String s) {
        if (s.isEmpty()) throw new LocalProblem();
        return s;
    }

    // a handler declared in the controller serves this controller only
    @ExceptionHandler(LocalProblem.class)
    public String onLocal(LocalProblem e) { return "local"; }
}
