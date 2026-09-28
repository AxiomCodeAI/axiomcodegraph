package shop.service;

import org.springframework.stereotype.Service;
import shop.config.MailProperties;
import shop.config.QueueProperties;

@Service
public class Mailer {
    private final MailProperties mail;
    private final QueueProperties queue;

    public Mailer(MailProperties mail, QueueProperties queue) {
        this.mail = mail;
        this.queue = queue;
    }

    public String host() { return mail.getHost() + queue.getDepth(); }
}
