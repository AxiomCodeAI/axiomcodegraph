package app;

import example.data.BaseMapper;

public interface WidgetMapper extends BaseMapper<Widget> {
    int archiveOld(int days);
    int countAll();
}
