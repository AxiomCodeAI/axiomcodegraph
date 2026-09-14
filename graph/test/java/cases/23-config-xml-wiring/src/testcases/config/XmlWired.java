package testcases.config;

/**
 * Engine test — XML WIRING.
 *
 * Nothing in this file calls MyServlet, MyFilter, MyListener, or MailSender. The
 * container does, because beans.xml and web.xml name them. Before this layer those
 * classes were indistinguishable from dead code; java_xml_element,
 * java_xml_attribute and java_xml_value_reference had zero consumers.
 *
 * Pinned here:
 *   <bean id class>                  -> bean_def (id, type)
 *   <bean class> with NO id          -> bean_def keyed by class name
 *   <constructor-arg ref="…">        -> di_edge xml_ref
 *   <property name ref="…">          -> di_edge xml_ref
 *   <property name value="${k}">     -> config_binding to the setter
 *   ref="nosuchbean"                 -> DECLARED unknown (dangling_bean_ref)
 *   class="com.nope.Missing"         -> DECLARED unknown (unresolved_class)
 *   init-method / destroy-method     -> config_entry_point (lifecycle_*)
 *   <servlet-class>/<filter-class>/
 *   <listener-class>                 -> config_entry_point (web_*)
 */

class Transport {
    void open()  { }
    void close() { }
}

class MailSender {
    private Transport transport;
    private String endpoint;

    MailSender(Transport transport) { this.transport = transport; }

    void setEndpoint(String endpoint) { this.endpoint = endpoint; }

    void start() { transport.open(); }     // named by init-method    — a container entry
    void stop()  { transport.close(); }    // named by destroy-method — a container entry
}

class MyServlet {
    void doGet()  { new MailSender(new Transport()).start(); }
    void doPost() { }
}

class MyFilter   { void doFilter() { } }
class MyListener { void contextInitialized() { } }
