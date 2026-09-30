package probe;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class Errors {
    @ExceptionHandler(OrderNotFound.class)
    public ResponseEntity<String> missing(OrderNotFound e) { return reply(404); }

    // a handler for the subtype only
    @ExceptionHandler({ExpressOrderNotFound.class})
    public ResponseEntity<String> missingExpress(RuntimeException e) { return reply(410); }

    // the handled type is the parameter's when the annotation names none
    @ExceptionHandler
    public ResponseEntity<String> declined(PaymentFailed e) { return reply(402); }

    // a library type: the framework and libraries throw it, not a project `new`
    @ExceptionHandler(Exception.class)
    public ResponseEntity<String> anything(Exception e) { return reply(500); }

    private ResponseEntity<String> reply(int status) { return ResponseEntity.status(status).body("x"); }
}
