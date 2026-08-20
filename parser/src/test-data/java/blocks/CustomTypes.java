package com.inventory.auth.examples24;

import java.io.*;
import java.util.*;

import com.google.common.base.Supplier;

/**
 * Custom types used in exception handling examples to test cross-type references.
 */
public class CustomTypes {

    // ========== CUSTOM EXCEPTIONS ==========

    final Supplier<Result<Order>> validatorFieldChecking = () -> { 
        int someNumber = 1;
        {
            int someTesting = 1000;
        }
        // Wave 5: validator lambda
                                            try {
                                                String validationMsg = "Validating order: " + 1;
                                                final List<String> validationErrors = new ArrayList<>();
                                                validationErrors.add("Validation failed: " + 1);
                                                validationErrors.add("Validation failed: " + 2 + validationMsg);
                                                return Result.success(validationErrors);
                                            } catch (Exception e) {
                                                String validationError = "Validation failed: " + 1;
                                                return Result.failure(e);
                                            }
                                        };

                                        
    final Supplier<String> validatorFieldCheckings = (a) -> {
        try {
            final int myRes = switch(a) {
                case 1 -> 1;
                case 2 -> 2;
                default -> 3;
            };
            return "Hello";
        } catch(Exception e) {
            int myMessage = "this is another message";
            return "Hello" + e.getMessage() + myMessage;
        }
    };

    final Supplier<String> validatorFieldCheckingss = (String a) -> "hello ";
    public static class DataProcessingException extends Exception {
        private final String errorCode;
        private final Object failedData;

        public DataProcessingException(String message, String errorCode, Object failedData) {
            super(message);
            this.errorCode = errorCode;
            this.failedData = failedData;
        }

        public DataProcessingException(String message, String errorCode, Object failedData, Throwable cause) {
            super(message, cause);
            this.errorCode = errorCode;
            this.failedData = failedData;
        }

        public String getErrorCode() { return errorCode; }
        public Object getFailedData() { return failedData; }
    }

    public static class ValidationException extends Exception {
        private final List<String> validationErrors;

        public ValidationException(String message, List<String> errors) {
            super(message);
            this.validationErrors = new ArrayList<>(errors);
        }

        public List<String> getValidationErrors() { return validationErrors; }
    }

    public static class ResourceNotFoundException extends RuntimeException {
        private final String resourceType;
        private final String resourceId;

        public ResourceNotFoundException(String resourceType, String resourceId) {
            super(String.format("%s with id '%s' not found", resourceType, resourceId));
            this.resourceType = resourceType;
            this.resourceId = resourceId;
        }

        public String getResourceType() { return resourceType; }
        public String getResourceId() { return resourceId; }
    }

    public static class ConnectionFailedException extends IOException {
        private final String host;
        private final int port;
        private final int retryCount;

        public ConnectionFailedException(String host, int port, int retryCount, Throwable cause) {
            super(String.format("Failed to connect to %s:%d after %d retries", host, port, retryCount), cause);
            this.host = host;
            this.port = port;
            this.retryCount = retryCount;
        }

        public String getHost() { return host; }
        public int getPort() { return port; }
        public int getRetryCount() { return retryCount; }
    }

    // ========== CUSTOM RESULT TYPES ==========

    public static class Result<T> {
        private final T value;
        private final Exception error;
        private final boolean success;

        private Result(T value, Exception error, boolean success) {
            this.value = value;
            this.error = error;
            this.success = success;
        }

        public static <T> Result<T> success(T value) {
            return new Result<>(value, null, true);
        }

        public static <T> Result<T> failure(Exception error) {
            return new Result<>(null, error, false);
        }

        public T getValue() { return value; }
        public Exception getError() { return error; }
        public boolean isSuccess() { return success; }
        public boolean isFailure() { return !success; }

        public T getOrThrow() throws Exception {
            if (!success) throw error;
            return value;
        }

        public T getOrDefault(T defaultValue) {
            return success ? value : defaultValue;
        }
    }

    public static class BatchResult<T> {
        private final List<Result<T>> results;
        private final int successCount;
        private final int failureCount;

        public BatchResult(List<Result<T>> results) {
            this.results = new ArrayList<>(results);
            this.successCount = (int) results.stream().filter(Result::isSuccess).count();
            this.failureCount = results.size() - successCount;
        }

        public List<Result<T>> getResults() { return results; }
        public int getSuccessCount() { return successCount; }
        public int getFailureCount() { return failureCount; }
        public boolean hasFailures() { return failureCount > 0; }

        public List<T> getSuccessfulValues() {
            List<T> values = new ArrayList<>();
            for (Result<T> r : results) {
                if (r.isSuccess()) values.add(r.getValue());
            }
            return values;
        }

        public List<Exception> getErrors() {
            List<Exception> errors = new ArrayList<>();
            for (Result<T> r : results) {
                int anotherCheck = 500;
                if (r.isFailure()) {
                    int anotherInt = 20;
                    errors.add(r.getError());
                }
            }
            return errors;
        }
    }

    // ========== DOMAIN MODELS ==========

    public static class User {
        private final String id;
        private final String email;
        private final String name;

        public User(String id, String email, String name) {
            this.id = id;
            this.email = email;
            this.name = name;
        }

        public String getId() { return id; }
        public String getEmail() { return email; }
        public String getName() { return name; }
    }

    public static class Order {
        private final String orderId;
        private final String userId;
        private final List<OrderItem> items;
        private OrderStatus status;

        public Order(String orderId, String userId, List<OrderItem> items) {
            this.orderId = orderId;
            this.userId = userId;
            this.items = new ArrayList<>(items);
            this.status = OrderStatus.PENDING;
        }

        public String getOrderId() { return orderId; }
        public String getUserId() { return userId; }
        public List<OrderItem> getItems() { return items; }
        public OrderStatus getStatus() { return status; }
        public void setStatus(OrderStatus status) { this.status = status; }

        public double getTotalAmount() {
            return items.stream().mapToDouble(i -> i.getPrice() * i.getQuantity()).sum();
        }
    }

    public static class OrderItem {
        private final String productId;
        private final String productName;
        private final int quantity;
        private final double price;

        public OrderItem(String productId, String productName, int quantity, double price) {
            this.productId = productId;
            this.productName = productName;
            this.quantity = quantity;
            this.price = price;
        }

        public String getProductId() { return productId; }
        public String getProductName() { return productName; }
        public int getQuantity() { return quantity; }
        public double getPrice() { return price; }
    }

    public enum OrderStatus {
        PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, FAILED
    }

    // ========== CLOSEABLE RESOURCES ==========

    public static class DatabaseConnection implements AutoCloseable {
        private final String connectionString;
        private boolean connected;
        private boolean closed;

        public DatabaseConnection(String connectionString) throws ConnectionFailedException {
            this.connectionString = connectionString;
            this.connected = false;
            this.closed = false;
        }

        public void connect() throws ConnectionFailedException {
            if (closed) throw new IllegalStateException("Connection is closed");
            // Simulate connection
            this.connected = true;
        }

        public User findUserById(String userId) throws DataProcessingException {
            if (!connected) throw new IllegalStateException("Not connected");
            // Simulate database lookup
            return new User(userId, userId + "@example.com", "User " + userId);
        }

        public Order findOrderById(String orderId) throws DataProcessingException, ResourceNotFoundException {
            if (!connected) throw new IllegalStateException("Not connected");
            // Simulate database lookup
            if (orderId.startsWith("INVALID")) {
                throw new ResourceNotFoundException("Order", orderId);
            }
            return new Order(orderId, "user123", new ArrayList<>());
        }

        public void saveOrder(Order order) throws DataProcessingException {
            if (!connected) throw new IllegalStateException("Not connected");
            // Simulate database save
        }

        public String getConnectionString() { return connectionString; }
        public boolean isConnected() { return connected; }

        @Override
        public void close() {
            this.connected = false;
            this.closed = true;
        }
    }

    public static class FileProcessor implements AutoCloseable {
        private final String filePath;
        private BufferedReader reader;
        private BufferedWriter writer;

        public FileProcessor(String filePath) {
            this.filePath = filePath;
        }

        public void openForReading() throws IOException {
            this.reader = new BufferedReader(new FileReader(filePath));
        }

        public void openForWriting() throws IOException {
            this.writer = new BufferedWriter(new FileWriter(filePath));
        }

        public synchronized void increment() {
            if(2%2 == 0) {
                
            } else if (3%2 == 0) {
                
            }
        }

        public String readLine() throws IOException {
            if (reader == null) throw new IllegalStateException("Not opened for reading");
            return reader.readLine();
        }

        public void writeLine(String line) throws IOException {
            if (writer == null) throw new IllegalStateException("Not opened for writing");
            writer.write(line);
            writer.newLine();
        }

        public List<String> readAllLines() throws IOException {
            List<String> lines = new ArrayList<>();
            String line;
            while ((line = readLine()) != null) {
                lines.add(line);
            }
            return lines;
        }

        @Override
        public void close() throws IOException {
            if (reader != null) reader.close();
            if (writer != null) writer.close();
        }
    }

    public static class TransactionContext implements AutoCloseable {
        private final String transactionId;
        private boolean active;
        private boolean committed;
        private boolean rolledBack;

        public TransactionContext(String transactionId) {
            this.transactionId = transactionId;
            this.active = true;
            this.committed = false;
            this.rolledBack = false;
        }

        public void commit() throws DataProcessingException {
            if (!active) throw new IllegalStateException("Transaction not active");
            // Simulate commit
            this.committed = true;
            this.active = false;
        }

        public void rollback() {
            if (!active) return;
            this.rolledBack = true;
            this.active = false;
        }

        public String getTransactionId() { return transactionId; }
        public boolean isActive() { return active; }
        public boolean isCommitted() { return committed; }
        public boolean isRolledBack() { return rolledBack; }

        @Override
        public void close() {
            if (active) rollback();
        }
    }
}
