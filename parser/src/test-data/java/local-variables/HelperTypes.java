package com.inventory.auth.examples23;

import java.io.Serializable;
import java.util.*;
import java.util.function.*;

/**
 * Helper types for testing cross-file type references in local variable extraction.
 * These types are defined in a separate file to verify that type resolution works
 * correctly across file boundaries.
 */

// ============================================================================
// BASIC HELPER CLASSES
// ============================================================================

/**
 * Simple data class for testing object creation and field access.
 */
public class HelperTypes {
    
    // Inner class for testing nested type references
    public static class Result<T> {
        private final T value;
        private final boolean success;
        private final String message;
        
        public Result(T value, boolean success, String message) {
            this.value = value;
            this.success = success;
            this.message = message;
        }
        
        public static <T> Result<T> success(T value) {
            return new Result<>(value, true, "Success");
        }
        
        public static <T> Result<T> failure(String message) {
            return new Result<>(null, false, message);
        }
        
        public T getValue() { return value; }
        public boolean isSuccess() { return success; }
        public String getMessage() { return message; }
        
        public <R> Result<R> map(Function<T, R> mapper) {
            if (success) {
                R mapped = mapper.apply(value);
                return Result.success(mapped);
            }
            return Result.failure(message);
        }
    }
    
    // Builder pattern class
    public static class RequestBuilder {
        private String url;
        private String method = "GET";
        private Map<String, String> headers = new HashMap<>();
        private String body;
        
        public RequestBuilder url(String url) {
            this.url = url;
            return this;
        }
        
        public RequestBuilder method(String method) {
            this.method = method;
            return this;
        }
        
        public RequestBuilder header(String key, String value) {
            this.headers.put(key, value);
            return this;
        }
        
        public RequestBuilder body(String body) {
            this.body = body;
            return this;
        }
        
        public Request build() {
            return new Request(url, method, headers, body);
        }
    }
    
    // Immutable request class
    public static class Request {
        private final String url;
        private final String method;
        private final Map<String, String> headers;
        private final String body;
        
        Request(String url, String method, Map<String, String> headers, String body) {
            this.url = url;
            this.method = method;
            this.headers = Collections.unmodifiableMap(new HashMap<>(headers));
            this.body = body;
        }
        
        public String getUrl() { return url; }
        public String getMethod() { return method; }
        public Map<String, String> getHeaders() { return headers; }
        public String getBody() { return body; }
    }
}

// ============================================================================
// RECORDS FOR PATTERN MATCHING TESTS
// ============================================================================

record Coordinate(double latitude, double longitude) {
    public double distanceTo(Coordinate other) {
        double dx = latitude - other.latitude;
        double dy = longitude - other.longitude;
        return Math.sqrt(dx * dx + dy * dy);
    }
}

record Address(String street, String city, String zipCode) {}

record Customer(String id, String name, Address address) {
    public String fullAddress() {
        return address.street() + ", " + address.city() + " " + address.zipCode();
    }
}

record Order(String orderId, Customer customer, List<OrderItem> items) {
    public double total() {
        return items.stream()
            .mapToDouble(item -> item.price() * item.quantity())
            .sum();
    }
}

record OrderItem(String productId, String name, double price, int quantity) {}

// Nested records for complex pattern matching
record Wrapper<T>(T content, long timestamp) {}

record Pair<A, B>(A first, B second) {
    public Pair<B, A> swap() {
        return new Pair<>(second, first);
    }
}

record Triple<A, B, C>(A first, B second, C third) {}

// ============================================================================
// ENUMS FOR SWITCH EXPRESSION TESTS
// ============================================================================

enum Priority {
    LOW(1, "Low Priority"),
    MEDIUM(5, "Medium Priority"),
    HIGH(10, "High Priority"),
    CRITICAL(100, "Critical Priority");
    
    private final int weight;
    private final String description;
    
    Priority(int weight, String description) {
        this.weight = weight;
        this.description = description;
    }
    
    public int getWeight() { return weight; }
    public String getDescription() { return description; }
    
    public Priority escalate() {
        return switch (this) {
            case LOW -> MEDIUM;
            case MEDIUM -> HIGH;
            case HIGH, CRITICAL -> CRITICAL;
        };
    }
}

enum HttpStatus {
    OK(200, "OK"),
    CREATED(201, "Created"),
    BAD_REQUEST(400, "Bad Request"),
    UNAUTHORIZED(401, "Unauthorized"),
    NOT_FOUND(404, "Not Found"),
    INTERNAL_ERROR(500, "Internal Server Error");
    
    private final int code;
    private final String reason;
    
    HttpStatus(int code, String reason) {
        this.code = code;
        this.reason = reason;
    }
    
    public int getCode() { return code; }
    public String getReason() { return reason; }
    
    public boolean isSuccess() {
        return code >= 200 && code < 300;
    }
    
    public boolean isError() {
        return code >= 400;
    }
}

// ============================================================================
// INTERFACES FOR FUNCTIONAL PROGRAMMING TESTS
// ============================================================================

@FunctionalInterface
interface Validator<T> {
    ValidationResult validate(T input);
    
    default Validator<T> and(Validator<T> other) {
        return input -> {
            ValidationResult result = validate(input);
            return result.isValid() ? other.validate(input) : result;
        };
    }
    
    default Validator<T> or(Validator<T> other) {
        return input -> {
            ValidationResult result = validate(input);
            return result.isValid() ? result : other.validate(input);
        };
    }
}

record ValidationResult(boolean isValid, List<String> errors) {
    public static ValidationResult valid() {
        return new ValidationResult(true, List.of());
    }
    
    public static ValidationResult invalid(String... errors) {
        return new ValidationResult(false, List.of(errors));
    }
}

@FunctionalInterface
interface ThrowingSupplier<T, E extends Exception> {
    T get() throws E;
}

@FunctionalInterface
interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T input) throws E;
}

// ============================================================================
// GENERIC UTILITY CLASSES
// ============================================================================

class Either<L, R> {
    private final L left;
    private final R right;
    private final boolean isRight;
    
    private Either(L left, R right, boolean isRight) {
        this.left = left;
        this.right = right;
        this.isRight = isRight;
    }
    
    public static <L, R> Either<L, R> left(L value) {
        return new Either<>(value, null, false);
    }
    
    public static <L, R> Either<L, R> right(R value) {
        return new Either<>(null, value, true);
    }
    
    public boolean isLeft() { return !isRight; }
    public boolean isRight() { return isRight; }
    public L getLeft() { return left; }
    public R getRight() { return right; }
    
    public <T> T fold(Function<L, T> leftMapper, Function<R, T> rightMapper) {
        return isRight ? rightMapper.apply(right) : leftMapper.apply(left);
    }
}

class Lazy<T> {
    private final Supplier<T> supplier;
    private T value;
    private boolean computed = false;
    
    public Lazy(Supplier<T> supplier) {
        this.supplier = supplier;
    }
    
    public synchronized T get() {
        if (!computed) {
            value = supplier.get();
            computed = true;
        }
        return value;
    }
    
    public <R> Lazy<R> map(Function<T, R> mapper) {
        return new Lazy<>(() -> mapper.apply(get()));
    }
}

// ============================================================================
// SEALED CLASSES FOR PATTERN MATCHING
// ============================================================================

sealed interface Shape permits Circle, Rectangle, Triangle {
    double area();
    double perimeter();
}

final class Circle implements Shape {
    private final double radius;
    
    public Circle(double radius) {
        this.radius = radius;
    }
    
    public double getRadius() { return radius; }
    
    @Override
    public double area() {
        return Math.PI * radius * radius;
    }
    
    @Override
    public double perimeter() {
        return 2 * Math.PI * radius;
    }
}

final class Rectangle implements Shape {
    private final double width;
    private final double height;
    
    public Rectangle(double width, double height) {
        this.width = width;
        this.height = height;
    }
    
    public double getWidth() { return width; }
    public double getHeight() { return height; }
    
    @Override
    public double area() {
        return width * height;
    }
    
    @Override
    public double perimeter() {
        return 2 * (width + height);
    }
}

final class Triangle implements Shape {
    private final double a, b, c;
    
    public Triangle(double a, double b, double c) {
        this.a = a;
        this.b = b;
        this.c = c;
    }
    
    public double getA() { return a; }
    public double getB() { return b; }
    public double getC() { return c; }
    
    @Override
    public double area() {
        double s = (a + b + c) / 2;
        return Math.sqrt(s * (s - a) * (s - b) * (s - c));
    }
    
    @Override
    public double perimeter() {
        return a + b + c;
    }
}

// ============================================================================
// SERVICE CLASSES FOR DEPENDENCY INJECTION TESTS
// ============================================================================

interface Repository<T, ID> {
    Optional<T> findById(ID id);
    List<T> findAll();
    T save(T entity);
    void delete(ID id);
}

class InMemoryRepository<T, ID> implements Repository<T, ID> {
    private final Map<ID, T> storage = new HashMap<>();
    private final Function<T, ID> idExtractor;
    
    public InMemoryRepository(Function<T, ID> idExtractor) {
        this.idExtractor = idExtractor;
    }
    
    @Override
    public Optional<T> findById(ID id) {
        return Optional.ofNullable(storage.get(id));
    }
    
    @Override
    public List<T> findAll() {
        return new ArrayList<>(storage.values());
    }
    
    @Override
    public T save(T entity) {
        ID id = idExtractor.apply(entity);
        storage.put(id, entity);
        return entity;
    }
    
    @Override
    public void delete(ID id) {
        storage.remove(id);
    }
}

// ============================================================================
// EXCEPTION CLASSES FOR TRY-CATCH TESTS
// ============================================================================

class BusinessException extends Exception {
    private final String errorCode;
    
    public BusinessException(String message, String errorCode) {
        super(message);
        this.errorCode = errorCode;
    }
    
    public String getErrorCode() { return errorCode; }
}

class ValidationException extends BusinessException {
    private final List<String> validationErrors;
    
    public ValidationException(String message, List<String> errors) {
        super(message, "VALIDATION_ERROR");
        this.validationErrors = errors;
    }
    
    public List<String> getValidationErrors() { return validationErrors; }
}

class NotFoundException extends BusinessException {
    private final String resourceType;
    private final String resourceId;
    
    public NotFoundException(String resourceType, String resourceId) {
        super(resourceType + " not found: " + resourceId, "NOT_FOUND");
        this.resourceType = resourceType;
        this.resourceId = resourceId;
    }
    
    public String getResourceType() { return resourceType; }
    public String getResourceId() { return resourceId; }
}
