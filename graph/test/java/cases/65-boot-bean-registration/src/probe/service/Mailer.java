package probe.service;

import org.springframework.stereotype.Service;
import probe.config.CacheProperties;
import probe.config.MailProperties;
import probe.config.QueueProperties;
import probe.scanned.ScanProperties;

@Service
public class Mailer {
    private final MailProperties mail;
    private final CacheProperties cache;
    private final QueueProperties queue;
    private final ScanProperties scan;

    public Mailer(MailProperties mail, CacheProperties cache, QueueProperties queue, ScanProperties scan) {
        this.mail = mail;
        this.cache = cache;
        this.queue = queue;
        this.scan = scan;
    }

    public String host() { return mail.getHost(); }

    public int size() { return cache.getSize() + queue.getDepth() + scan.getLimit(); }
}
