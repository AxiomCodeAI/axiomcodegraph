package app;
import org.springframework.beans.factory.annotation.Value;
public class OrderJob {
    @Value("${app.orders.batch_size}")
    int batchSize;
    @Value("${app.orders.timeout}")
    int timeout;
}
