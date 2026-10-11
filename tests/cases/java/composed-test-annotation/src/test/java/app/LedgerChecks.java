package app;

import org.junit.jupiter.api.Test;

class LedgerChecks {
    @IntegrationCase
    void balancesTotals() { Ledger.total(); }

    @SlowIntegrationCase
    void sweepsNightly() { Ledger.sweep(); }

    @Audited
    void auditTrail() { Ledger.audit(); }

    @Test
    void control() { Ledger.count(); }
}
