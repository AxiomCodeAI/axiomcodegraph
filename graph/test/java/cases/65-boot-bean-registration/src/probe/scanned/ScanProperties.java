package probe.scanned;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** SUBJECT: picked up by @ConfigurationPropertiesScan("probe.scanned"). */
@ConfigurationProperties("app.scan")
public class ScanProperties {
    private int limit;

    public int getLimit() { return limit; }

    public void setLimit(int limit) { this.limit = limit; }
}
