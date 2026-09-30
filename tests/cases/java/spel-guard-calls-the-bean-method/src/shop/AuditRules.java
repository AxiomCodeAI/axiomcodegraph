package shop;

import org.springframework.stereotype.Service;

@Service("audits")
public class AuditRules {
    public boolean allowed(String who) { return who != null; }

    public boolean archived(String who) { return false; }
}
