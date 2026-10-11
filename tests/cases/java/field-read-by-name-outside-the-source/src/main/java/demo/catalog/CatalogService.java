package demo.catalog;
import cn.hutool.core.bean.BeanUtil;
import demo.item.Item;
import demo.item.ItemView;
import demo.part.Part;
import demo.part.PartView;
public class CatalogService {
    public ItemView itemInfo(Item item) {
        ItemView dto = BeanUtil.copyProperties(item, ItemView.class);
        return dto;
    }
    public PartView partInfo(Long id) {
        Part part = load(id);
        PartView dto = BeanUtil.copyProperties(part, PartView.class);
        return dto;
    }
    private Part load(Long id) { return new Part(); }
}
