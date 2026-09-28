package probe;

import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

@Component
public class ShipListener implements ApplicationListener<OrderShipped> {
    @Override
    public void onApplicationEvent(OrderShipped event) { notifyWarehouse(); }

    void notifyWarehouse() { }
}
