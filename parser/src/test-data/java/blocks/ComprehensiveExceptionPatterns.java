package com.inventory.auth.examples4;

import java.io.BufferedReader;
import java.io.EOFException;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Serializable;
import java.io.UncheckedIOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.Callable;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

import javax.validation.constraints.NotBlank;

import com.inventory.auth.domain.Permission;
import com.inventory.auth.domain.Role;
import com.inventory.auth.domain.Session;
import com.inventory.auth.domain.User;
import com.inventory.auth.examples4.TypeUseAnnotationPatterns.NotEmpty;

/**
 * Comprehensive Exception and Throws Clause Patterns
 * 
 * This file demonstrates ALL locations where throws clauses and exception handling
 * can appear in Java, for thorough extraction testing of THROWS_CLAUSE contexts.
 * 
 * Coverage:
 * 1. Method declaration throws
 * 2. Constructor declaration throws
 * 3. Generic methods with exception type parameters
 * 4. Interface methods (regular, default, static)
 * 5. Abstract methods
 * 6. Record constructors (canonical with throws, compact without)
 * 7. Try-catch blocks (single, multi-catch)
 * 8. Try-with-resources
 * 9. Lambda expressions (implicit exception handling)
 * 10. Anonymous class methods
 * 11. Local class methods
 * 12. Sealed types with exception inheritance
 * 13. Enum constructors (no throws allowed)
 * 14. Initializer blocks (no throws allowed)
 */
@SuppressWarnings({"unused", "RedundantThrows"})
public class ComprehensiveExceptionPatterns {

    // =========================================================================
    // SECTION 1: METHOD DECLARATION THROWS CLAUSE
    // =========================================================================

    // Mixed import styles - wildcard (*) and concrete from domain package
    // Session and Role come from wildcard import com.inventory.auth.domain.*
    // User comes from concrete import com.inventory.auth.domain.User
    public void mixedImportStylesWithThrows(
            Session session,
            Role role,
            User user,
            Permission permission) throws IOException, ValidationException {
        if (session == null || user == null) {
            throw new IOException("Session or User cannot be null");
        }
        if (role == null) {
            throw new ValidationException("Role required");
        }
    }

    // Generic method with domain types and multiple exceptions
    public <T extends Session> T processSessionWithException(
            T session,
            User owner,
            List<Role> roles) throws IOException, SQLException, ProcessingException {
        if (session == null) {
            throw new ProcessingException("Session null");
        }
        return session;
    }

    // Single exception
    public void singleException() throws IOException {
        throw new IOException("Single exception");
    }

    // Multiple exceptions
    public void multipleExceptions() throws IOException, SQLException, InterruptedException {
        throw new IOException("Multiple exceptions");
    }

    // Generic return with exceptions
    public <T> T genericReturnWithException(Class<T> clazz) throws InstantiationException, IllegalAccessException {
        return clazz.newInstance();
    }

    // Checked and unchecked mixed
    public void mixedExceptions() throws IOException, RuntimeException, Error {
        throw new IOException("Mixed");
    }

    // Overloaded methods with different throws
    public void overloadedMethod(String s) throws IOException {
        throw new IOException("String version");
    }

    public void overloadedMethod(int i) throws SQLException {
        throw new SQLException("Int version");
    }

    public void overloadedMethod(String s, int i) throws IOException, SQLException {
        throw new IOException("Both version");
    }

    // =========================================================================
    // SECTION 2: CONSTRUCTOR DECLARATION THROWS CLAUSE
    // =========================================================================

    public static class ConstructorExceptions {
        private final String value;
        private final Connection conn;

        // Constructor with single exception
        public ConstructorExceptions(String value) throws IllegalArgumentException {
            if (value == null) {
                throw new IllegalArgumentException("Value cannot be null");
            }
            this.value = value;
            this.conn = null;
        }

        // Constructor with multiple exceptions
        public ConstructorExceptions(String value, String url) throws IOException, SQLException {
            if (value == null) {
                throw new IOException("Value null");
            }
            this.value = value;
            this.conn = DriverManager.getConnection(url);
        }

        // Constructor with generic exception type parameter
        public <E extends Exception> ConstructorExceptions(String value, Class<E> exceptionType) throws E {
            this.value = value;
            this.conn = null;
        }

        // Overloaded constructors with different throws
        public ConstructorExceptions() throws FileNotFoundException {
            this.value = "default";
            this.conn = null;
            throw new FileNotFoundException("Default constructor");
        }
    }

    // =========================================================================
    // SECTION 3: GENERIC METHOD WITH EXCEPTION TYPE PARAMETER
    // =========================================================================

    // Single generic exception type
    public <E extends Exception> void singleGenericException(Class<E> type) throws E {
        throw type.getDeclaredConstructor().newInstance();
    }

    // Multiple generic exception types
    public <E1 extends Exception, E2 extends Exception> void multipleGenericExceptions() throws E1, E2 {
        // Can potentially throw both
    }

    // Generic exception with bounds
    public <E extends IOException> void boundedGenericException(E exception) throws E {
        throw exception;
    }

    // Generic method with generic return and exception
    public <T, E extends Exception> T genericReturnAndException(Supplier<T> supplier, Class<E> exType) throws E {
        try {
            return supplier.get();
        } catch (Exception e) {
            throw exType.getDeclaredConstructor().newInstance();
        }
    }

    // Mixing regular and generic exceptions
    public <E extends Exception> void mixedRegularAndGeneric() throws IOException, E, SQLException {
        throw new IOException("Mixed");
    }

    // Generic exception with intersection bounds
    public <E extends Exception & Serializable> void genericWithIntersection(E exception) throws E {
        throw exception;
    }

    // =========================================================================
    // SECTION 4: TRY-CATCH BLOCKS
    // =========================================================================

    public void singleCatch() {
        try {
            throw new IOException("Test");
        } catch (IOException e) {
            System.err.println("Caught: " + e.getMessage());
        }
    }

    public void multipleCatch() {
        try {
            throw new SQLException("Test");
        } catch (IOException e) {
            System.err.println("IO: " + e);
        } catch (SQLException e) {
            System.err.println("SQL: " + e);
        } catch (Exception e) {
            System.err.println("General: " + e);
        }
    }

    // Multi-catch (Java 7+)
    public void multiCatch() {
        try {
            throw new IOException("Test");
        } catch (IOException | SQLException e) {
            System.err.println("Multi-catch: " + e);
        }
    }

    // Try-catch-finally
    public void tryCatchFinally() {
        try {
            throw new IOException("Test");
        } catch (IOException e) {
            System.err.println("Caught");
        } finally {
            System.out.println("Finally");
        }
    }

    // Nested try-catch
    public void nestedTryCatch() {
        try {
            try {
                throw new IOException("Inner");
            } catch (IOException inner) {
                throw new SQLException("Outer", inner);
            }
        } catch (SQLException outer) {
            System.err.println("Outer caught: " + outer);
        }
    }

    // Try with multiple catch types
    public void complexMultiCatch() {
        try {
            throw new FileNotFoundException("Test");
        } catch (FileNotFoundException | EOFException e) {
            System.err.println("File exception: " + e);
        } catch (IOException e) {
            System.err.println("IO exception: " + e);
        } catch (Exception e) {
            System.err.println("General exception: " + e);
        }
    }

    // =========================================================================
    // SECTION 5: TRY-WITH-RESOURCES
    // =========================================================================

    // Single resource
    public void trySingleResource() throws IOException {
        try (FileInputStream fis = new FileInputStream("file.txt")) {
            int data = fis.read();
        }
    }

    // Multiple resources
    public void tryMultipleResources() throws IOException {
        try (FileInputStream fis = new FileInputStream("file.txt");
             BufferedReader br = new BufferedReader(new InputStreamReader(fis));
             FileOutputStream fos = new FileOutputStream("output.txt")) {
            String line = br.readLine();
            fos.write(line.getBytes());
        }
    }

    // Try-with-resources with catch
    public void tryResourcesWithCatch() {
        try (FileInputStream fis = new FileInputStream("file.txt")) {
            int data = fis.read();
        } catch (IOException e) {
            System.err.println("Caught: " + e);
        }
    }

    // Try-with-resources with finally
    public void tryResourcesWithFinally() throws IOException {
        try (FileInputStream fis = new FileInputStream("file.txt")) {
            int data = fis.read();
        } finally {
            System.out.println("Finally");
        }
    }

    // Try-with-resources with catch and finally
    public void tryResourcesComplete() {
        try (FileInputStream fis = new FileInputStream("file.txt");
             BufferedReader br = new BufferedReader(new InputStreamReader(fis))) {
            String line = br.readLine();
        } catch (IOException e) {
            System.err.println("IO error: " + e);
        } finally {
            System.out.println("Cleanup");
        }
    }

    // Nested try-with-resources
    public void nestedTryResources() throws IOException {
        try (FileInputStream outer = new FileInputStream("outer.txt")) {
            try (FileInputStream inner = new FileInputStream("inner.txt")) {
                outer.read();
                inner.read();
            }
        }
    }

    // =========================================================================
    // SECTION 6: INTERFACE METHOD DECLARATIONS
    // =========================================================================

    public interface DataProcessor {
        // Regular interface method with throws
        void process(String data) throws ProcessingException;

        // Multiple exceptions
        void processMultiple(String data) throws IOException, SQLException, ProcessingException;

        // Generic exception
        <E extends Exception> void processGeneric(String data, Class<E> exType) throws E;

        // Default method with throws (Java 8+)
        default void processAll(List<String> items) throws ProcessingException {
            for (String item : items) {
                process(item);
            }
        }

        // Default method with multiple exceptions
        default void processAllSafe(List<String> items) throws IOException, ProcessingException {
            for (String item : items) {
                process(item);
            }
        }

        // Static method with throws (Java 8+)
        static DataProcessor create(String type) throws ConfigException {
            if (type == null) {
                throw new ConfigException("Type cannot be null");
            }
            return new DataProcessorImpl();
        }

        // Static method with multiple exceptions
        static DataProcessor createFromFile(String path) throws IOException, ConfigException {
            if (path == null) {
                throw new IOException("Path null");
            }
            throw new ConfigException("Config error");
        }

        // Generic static method with exception
        static <T, E extends Exception> T load(Class<T> clazz) throws E, IOException {
            throw new IOException("Cannot load");
        }
    }

    // Implementation
    static class DataProcessorImpl implements DataProcessor {
        @Override
        public void process(String data) throws ProcessingException {
            if (data == null) {
                throw new ProcessingException("Null data");
            }
        }

        @Override
        public void processMultiple(String data) throws IOException, SQLException, ProcessingException {
            throw new ProcessingException("Error");
        }

        @Override
        public <E extends Exception> void processGeneric(String data, Class<E> exType) throws E {
            throw exType.getDeclaredConstructor().newInstance();
        }
    }

    // =========================================================================
    // SECTION 7: ABSTRACT METHOD DECLARATIONS
    // =========================================================================

    public abstract static class AbstractService {
        // Abstract method with single exception
        public abstract void execute() throws ServiceException;

        // Abstract method with multiple exceptions
        public abstract void executeMultiple() throws IOException, SQLException, ServiceException;

        // Abstract generic method with exception
        public abstract <E extends Exception> void executeGeneric(Class<E> exType) throws E;

        // Abstract method with generic return and exception
        public abstract <T, E extends Exception> T fetchData(Class<T> type) throws E;

        // Concrete method with throws in abstract class
        public void concreteMethod() throws IOException {
            throw new IOException("Concrete in abstract class");
        }
    }

    static class ConcreteService extends AbstractService {
        @Override
        public void execute() throws ServiceException {
            throw new ServiceException("Execute");
        }

        @Override
        public void executeMultiple() throws IOException, SQLException, ServiceException {
            throw new ServiceException("Multiple");
        }

        @Override
        public <E extends Exception> void executeGeneric(Class<E> exType) throws E {
            throw exType.getDeclaredConstructor().newInstance();
        }

        @Override
        public <T, E extends Exception> T fetchData(Class<T> type) throws E {
            return null;
        }
    }

    // =========================================================================
    // SECTION 8: LAMBDA EXPRESSIONS (Implicit Exception Handling)
    // =========================================================================

    public void lambdaExpressions() throws Exception {
        // Lambda that can throw - functional interface declares it
        Callable<String> callable = () -> {
            throw new Exception("Lambda exception");
        };

        // Lambda with try-catch internally
        Runnable runnable = () -> {
            try {
                throw new IOException("Handled internally");
            } catch (IOException e) {
                System.err.println("Caught in lambda: " + e);
            }
        };

        // Lambda with checked exception wrapped as unchecked
        Consumer<String> consumer = (s) -> {
            try {
                new FileInputStream(s);
            } catch (FileNotFoundException e) {
                throw new RuntimeException(e);
            }
        };

        // Callable with generic exception
        Callable<Integer> callableInt = () -> {
            if (Math.random() > 0.5) {
                throw new Exception("Random exception");
            }
            return 42;
        };
    }

    // =========================================================================
    // SECTION 9: ANONYMOUS CLASS METHODS
    // =========================================================================

    public void anonymousClasses() {
        // Anonymous Runnable - cannot add throws
        Runnable r1 = new Runnable() {
            @Override
            public void run() {
                // Cannot add throws - must match interface
                try {
                    throw new IOException("Must catch");
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
        };

        // Anonymous Callable - CAN throw because interface declares it
        Callable<String> c1 = new Callable<String>() {
            @Override
            public String call() throws Exception {
                throw new Exception("Callable can throw");
            }
        };

        // Anonymous class with custom exception
        DataProcessor processor = new DataProcessor() {
            @Override
            public void process(String data) throws ProcessingException {
                throw new ProcessingException("Anonymous processor");
            }

            @Override
            public void processMultiple(String data) throws IOException, SQLException, ProcessingException {
                throw new SQLException("Anonymous multi");
            }

            @Override
            public <E extends Exception> void processGeneric(String data, Class<E> exType) throws E {
                throw exType.getDeclaredConstructor().newInstance();
            }
        };
    }

    // =========================================================================
    // SECTION 10: LOCAL CLASS METHODS
    // =========================================================================

    public void localClassMethods() {
        // Local class with throws on methods
        class LocalProcessor {
            void process() throws IOException {
                throw new IOException("Local class method");
            }

            void processMultiple() throws IOException, SQLException {
                throw new SQLException("Local multi");
            }

            <E extends Exception> void processGeneric(Class<E> exType) throws E {
                throw exType.getDeclaredConstructor().newInstance();
            }

            // Local class constructor with throws
            LocalProcessor(String config) throws ConfigException {
                if (config == null) {
                    throw new ConfigException("Config null");
                }
            }
        }

        try {
            LocalProcessor lp = new LocalProcessor("config");
            lp.process();
        } catch (Exception e) {
            System.err.println("Caught from local class: " + e);
        }
    }

    // =========================================================================
    // SECTION 11: RECORD CONSTRUCTORS (Java 16+)
    // =========================================================================

    // Record with compact constructor (CANNOT declare throws)
    public record CompactConstructorRecord(@NotBlank String value, String... random) {
        public CompactConstructorRecord {
            // Compact constructor cannot declare throws
            // Can only throw unchecked exceptions
            if (value == null) {
                throw new IllegalArgumentException("Value cannot be null");
            }
        }
    }

    // Record demonstrating that canonical/compact constructor CANNOT declare throws
    // Note: Canonical constructor (matching all record params) same restriction as compact
    public record CanonicalConstructorExample(@NotEmpty String value, int code) {
        // Compact form - cannot declare throws
        public CanonicalConstructorExample {
            if (value == null) {
                throw new IllegalArgumentException("Only unchecked exceptions allowed");
            }
        }
        // If we wrote explicit canonical constructor, still cannot add throws:
        // public CanonicalConstructorExample(String value, int code) throws Exception { } // INVALID!
    }

    // Record with additional constructor (CAN declare throws)
    public record AdditionalConstructorRecord(String value, int code) {
        public AdditionalConstructorRecord(String value) throws IOException {
            this(value, 0);
            if (value == null) {
                throw new IOException("Additional constructor");
            }
        }
    }

    // Record with method throwing exception
    public record RecordWithMethod(Role[] role, Session... data) {
        public void process() throws ProcessingException {
            if (data == null) {
                throw new ProcessingException("Record method exception");
            }
        }

        public <E extends Exception> void processGeneric(Class<E> exType) throws E {
            throw exType.getDeclaredConstructor().newInstance();
        }
    }

    // =========================================================================
    // SECTION 12: SEALED TYPES WITH EXCEPTION INHERITANCE
    // =========================================================================

    public sealed interface Processor permits SafeProcessor, RiskyProcessor, GenericProcessor {
        void process() throws ProcessingException;

        default void processAll(List<String> items) throws ProcessingException, IOException {
            for (String item : items) {
                process();
            }
        }
    }

    public final class SafeProcessor implements Processor {
        @Override
        public void process() {
            // Can narrow - remove throws completely
            System.out.println("Safe processing - no exceptions");
        }
    }

    public final class RiskyProcessor implements Processor {
        @Override
        public void process() throws ProcessingException {
            // Must declare or narrow
            throw new ProcessingException("Risky processing");
        }

        public void processWithIO() throws ProcessingException, IOException {
            throw new IOException("Risky with IO");
        }
    }

    public final class GenericProcessor implements Processor {
        @Override
        public void process() throws ProcessingException {
            throw new ProcessingException("Generic processing");
        }

        public <E extends Exception> void processWithGeneric(Class<E> exType) throws E, ProcessingException {
            if (Math.random() > 0.5) {
                throw new ProcessingException("Processing error");
            }
            throw exType.getDeclaredConstructor().newInstance();
        }
    }

    // Sealed class hierarchy with exceptions
    public sealed abstract class Result<T> permits Success, Failure {
        public abstract T getValue() throws ResultException;

        public abstract boolean isSuccess() throws ValidationException;
    }

    public final class Success<T> extends Result<T> {
        private final T value;

        public Success(T value) throws ValidationException {
            if (value == null) {
                throw new ValidationException("Success value cannot be null");
            }
            this.value = value;
        }

        @Override
        public T getValue() {
            // Narrowing - removing throws
            return value;
        }

        @Override
        public boolean isSuccess() {
            return true;
        }
    }

    public final class Failure<T> extends Result<T> {
        private final Exception error;

        public Failure(Exception error) {
            this.error = error;
        }

        @Override
        public T getValue() throws ResultException {
            throw new ResultException("Failed result", error);
        }

        @Override
        public boolean isSuccess() throws ValidationException {
            if (error == null) {
                throw new ValidationException("Failure must have error");
            }
            return false;
        }
    }

    // =========================================================================
    // SECTION 13: ENUM (Constructor CANNOT declare throws)
    // =========================================================================

    public enum Status {
        ACTIVE("active"),
        INACTIVE("inactive"),
        PENDING("pending");

        private final String code;

        // Enum constructor CANNOT declare throws
        // Can only throw unchecked exceptions
        Status(String code) {
            if (code == null) {
                throw new IllegalArgumentException("Code cannot be null");
            }
            this.code = code;
        }

        public String getCode() {
            return code;
        }

        // Enum methods CAN declare throws
        public void validate() throws ValidationException {
            if (code.isEmpty()) {
                throw new ValidationException("Empty code");
            }
        }

        public static Status fromCode(String code) throws ConfigException {
            for (Status s : values()) {
                if (s.code.equals(code)) {
                    return s;
                }
            }
            throw new ConfigException("Invalid code: " + code);
        }
    }

    // =========================================================================
    // SECTION 14: INITIALIZER BLOCKS (Cannot declare throws)
    // =========================================================================

    public static class InitializerBlockExamples {
        private final String value;
        private static final Properties props;

        // Instance initializer - CANNOT declare throws
        // Checked exceptions only if ALL constructors declare them
        {
            try {
                value = loadValue();
            } catch (IOException e) {
                // Must wrap in unchecked
                throw new RuntimeException("Instance initializer error", e);
            }
        }

        // Static initializer - CANNOT declare throws
        // Can only throw unchecked (ExceptionInInitializerError)
        static {
            try {
                props = new Properties();
                props.load(new FileInputStream("config.properties"));
            } catch (IOException e) {
                throw new ExceptionInInitializerError(e);
            }
        }

        private static String loadValue() throws IOException {
            throw new IOException("Load error");
        }

        public InitializerBlockExamples() {
            // Constructor doesn't need to declare throws if instance initializer wraps
        }
    }

    // =========================================================================
    // SECTION 15: FIELD INITIALIZERS (Cannot declare throws)
    // =========================================================================

    public static class FieldInitializerExamples {
        // Field initializer CANNOT directly use checked exceptions
        // This would fail:
        // private final FileInputStream fis = new FileInputStream("file.txt");

        // Must wrap in method that handles exception
        private final FileInputStream fis = createStream();

        private static FileInputStream createStream() {
            try {
                return new FileInputStream("file.txt");
            } catch (FileNotFoundException e) {
                throw new RuntimeException("Field init error", e);
            }
        }

        // Or use supplier with exception handling
        private final String config = loadConfig();

        private String loadConfig() {
            try {
                return new String(new FileInputStream("config.txt").readAllBytes());
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
    }

    // =========================================================================
    // SECTION 16: METHOD REFERENCE WITH EXCEPTIONS
    // =========================================================================

    public void methodReferences() throws Exception {
        // Method reference that throws
        Callable<String> c1 = this::methodThatThrows;

        // Method reference in stream with exception handling
        List<String> files = Arrays.asList("a.txt", "b.txt");

        // This doesn't work directly:
        // files.stream().map(FileInputStream::new)

        // Must wrap:
        files.stream().map(f -> {
            try {
                return new FileInputStream(f);
            } catch (FileNotFoundException e) {
                throw new RuntimeException(e);
            }
        });
    }

    private String methodThatThrows() throws Exception {
        throw new Exception("Method reference exception");
    }

    // =========================================================================
    // SECTION 17: VARARGS WITH EXCEPTIONS
    // =========================================================================

    @SafeVarargs
    public final <T> void varargsWithException(T... items) throws ProcessingException {
        for (T item : items) {
            if (item == null) {
                throw new ProcessingException("Null item in varargs");
            }
        }
    }

    public void multipleExceptionsVarargs(String... paths) throws IOException, SQLException {
        for (String path : paths) {
            new FileInputStream(path);
        }
    }

    // =========================================================================
    // SECTION 18: NESTED EXCEPTIONS IN GENERICS
    // =========================================================================

    public <T, E1 extends Exception, E2 extends Exception> T complexGenericExceptions(
            Supplier<T> supplier,
            Class<E1> ex1,
            Class<E2> ex2) throws E1, E2, IOException {
        try {
            return supplier.get();
        } catch (Exception e) {
            if (Math.random() > 0.66) {
                throw ex1.getDeclaredConstructor().newInstance();
            } else if (Math.random() > 0.33) {
                throw ex2.getDeclaredConstructor().newInstance();
            } else {
                throw new IOException("Complex exception");
            }
        }
    }
}

// =============================================================================
// CUSTOM EXCEPTION TYPES
// =============================================================================

class ProcessingException extends Exception {
    public ProcessingException(String message) {
        super(message);
    }
}

class ConfigException extends Exception {
    public ConfigException(String message) {
        super(message);
    }
}

class ServiceException extends Exception {
    public ServiceException(String message) {
        super(message);
    }
}

class ValidationException extends Exception {
    public ValidationException(String message) {
        super(message);
    }
}

class ResultException extends Exception {
    public ResultException(String message, Throwable cause) {
        super(message, cause);
    }
}
