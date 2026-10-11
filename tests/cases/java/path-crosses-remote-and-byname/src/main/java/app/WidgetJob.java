package app;

public class WidgetJob {
    private WidgetMapper mapper;
    public int run() {
        return mapper.archiveOld(7);
    }
}
