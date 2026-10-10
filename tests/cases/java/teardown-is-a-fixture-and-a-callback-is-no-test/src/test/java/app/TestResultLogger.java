package app;

import org.junit.jupiter.api.extension.ExtensionContext;
import org.junit.jupiter.api.extension.TestWatcher;

class TestResultLogger implements TestWatcher {
    @Override
    public void testSuccessful(ExtensionContext c) { Report.pass(); }

    @Override
    public void testFailed(ExtensionContext c, Throwable t) { Report.fail(); }
}
