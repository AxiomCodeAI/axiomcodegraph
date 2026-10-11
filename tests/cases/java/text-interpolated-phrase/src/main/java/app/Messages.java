package app;

import java.text.MessageFormat;

public class Messages {
    public void requireScope(String scope) {
        throw new IllegalArgumentException(String.format("no indexed file has '%s' in its path", scope));
    }

    public String quota(String user, int n) {
        return "quota for " + user + " is exhausted after " + n + " requests";
    }

    public String sealed(String name) {
        return MessageFormat.format("the archive {0} was never sealed", name);
    }

    public Object[] farApart(int n) {
        String note = "the ledger is";
        int total = n + 1;
        return new Object[] {note, total, "out of balance"};
    }
}
