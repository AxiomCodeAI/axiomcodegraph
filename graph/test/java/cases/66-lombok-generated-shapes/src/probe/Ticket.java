package probe;

import lombok.Builder;

/** #1405: a PARTIAL builder written in the source is the builder; its written member wins. */
@Builder(builderMethodName = "make")
public class Ticket {
    private String title;

    public void open() {
    }

    public static class TicketBuilder {
        public TicketBuilder title(String t) {
            this.title = t;
            return this;
        }
        private String title;
    }
}
