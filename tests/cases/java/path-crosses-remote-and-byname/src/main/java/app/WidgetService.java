package app;

import example.data.ServiceImpl;

public class WidgetService extends ServiceImpl<WidgetMapper, Widget> {
    public int cleanup() {
        return this.baseMapper.archiveOld(30);
    }
    public int count() {
        return this.baseMapper.countAll();
    }
}
