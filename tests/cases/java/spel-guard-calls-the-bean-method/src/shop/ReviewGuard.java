package shop;

import org.springframework.stereotype.Component;

@Component
public class ReviewGuard implements Reviewer {
    @Override
    public boolean mayReview(String orderId) { return true; }
}
