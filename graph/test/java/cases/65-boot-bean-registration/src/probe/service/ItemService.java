package probe.service;

import org.springframework.stereotype.Service;
import probe.convert.ItemConverter;
import probe.dao.StockMapper;
import probe.daoextra.ExtraDao;
import probe.mapper.ItemMapper;
import probe.other.TagMapper;
import probe.shop.dao.OrderDao;

@Service
public class ItemService {
    private final ItemMapper items;
    private final StockMapper stock;
    private final OrderDao orders;
    private final ExtraDao extra;
    private final TagMapper tags;
    private final ItemConverter converter;
    private final PriceSource prices;

    public ItemService(ItemMapper items, StockMapper stock, OrderDao orders, ExtraDao extra,
                       TagMapper tags, ItemConverter converter, PriceSource prices) {
        this.items = items;
        this.stock = stock;
        this.orders = orders;
        this.extra = extra;
        this.tags = tags;
        this.converter = converter;
        this.prices = prices;
    }

    public int touch(Long id) {
        return items.touch(id) + stock.count(id) + orders.open(id) + extra.extra(id) + tags.tag(id);
    }
}
