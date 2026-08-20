package com.inventory.auth.examples23;

import java.util.*;
import java.util.function.*;
import java.util.stream.*;

/**
 * Test cases for local variables that reference types defined in other files.
 * This tests cross-file type resolution for local variables.
 */
public class CrossFileLocalVariables {

    // ========================================================================
    // SECTION 1: USING HELPER TYPES FROM HelperTypes.java
    // ========================================================================
    public static final HelperTypes.Result<String> stringResult = HelperTypes.Result.success("hello");

    public void usingResultType() {
        // Generic Result type from HelperTypes
        HelperTypes.Result<String> stringResult = HelperTypes.Result.success("hello");
        HelperTypes.Result<Integer> intResult = HelperTypes.Result.success(42);
        HelperTypes.Result<String> failureResult = HelperTypes.Result.failure("error");
        
        // Extracting values
        String value = stringResult.getValue();
        boolean isSuccess = stringResult.isSuccess();
        String message = stringResult.getMessage();
        
        // Chained operations
        HelperTypes.Result<Integer> mappedResult = stringResult.map(s -> s.length());
        Integer mappedValue = mappedResult.getValue();
        
        // Nested generic
        HelperTypes.Result<List<String>> listResult = HelperTypes.Result.success(List.of("a", "b"));
        List<String> listValue = listResult.getValue();
    }
    
    public void usingBuilderPattern() {
        // Builder pattern from HelperTypes
        HelperTypes.RequestBuilder builder = new HelperTypes.RequestBuilder();
        
        // Fluent API with local variable reassignment
        HelperTypes.RequestBuilder configuredBuilder = builder
            .url("https://api.example.com")
            .method("POST")
            .header("Content-Type", "application/json")
            .body("{\"key\": \"value\"}");
        
        // Build the request
        HelperTypes.Request request = configuredBuilder.build();
        
        // Extract request properties
        String url = request.getUrl();
        String method = request.getMethod();
        Map<String, String> headers = request.getHeaders();
        String body = request.getBody();
    }
    
    // ========================================================================
    // SECTION 2: USING RECORDS FROM HelperTypes.java
    // ========================================================================
    
    public void usingRecords() {
        // Simple records
        Coordinate coord1 = new Coordinate(40.7128, -74.0060);
        Coordinate coord2 = new Coordinate(34.0522, -118.2437);
        
        // Record method call result
        double distance = coord1.distanceTo(coord2);
        
        // Nested records
        Address address = new Address("123 Main St", "New York", "10001");
        Customer customer = new Customer("C001", "Alice", address);
        
        // Accessing nested record fields
        String street = customer.address().street();
        String city = customer.address().city();
        String fullAddr = customer.fullAddress();
        
        // Complex records with collections
        OrderItem item1 = new OrderItem("P001", "Widget", 9.99, 2);
        OrderItem item2 = new OrderItem("P002", "Gadget", 19.99, 1);
        List<OrderItem> items = List.of(item1, item2);
        
        Order order = new Order("O001", customer, items);
        double total = order.total();
        
        // Generic records
        Wrapper<String> stringWrapper = new Wrapper<>("content", System.currentTimeMillis());
        String content = stringWrapper.content();
        long timestamp = stringWrapper.timestamp();
        
        Pair<String, Integer> pair = new Pair<>("key", 100);
        String first = pair.first();
        Integer second = pair.second();
        Pair<Integer, String> swapped = pair.swap();
        
        Triple<String, Integer, Boolean> triple = new Triple<>("a", 1, true);
    }
    
    // ========================================================================
    // SECTION 3: PATTERN MATCHING WITH EXTERNAL RECORDS
    // ========================================================================
    
    public void patternMatchingWithRecords() {
        Object obj = new Coordinate(1.0, 2.0);
        
        // instanceof pattern with external record
        if (obj instanceof Coordinate coord) {
            double lat = coord.latitude();
            double lon = coord.longitude();
        }
        
        // Record pattern with external record
        if (obj instanceof Coordinate(double lat, double lon)) {
            double sum = lat + lon;
        }
        
        // Switch with external records
        Object shape = new Address("street", "city", "zip");
        String description = switch (shape) {
            case Coordinate(double lat, double lon) -> "Coord: " + lat + ", " + lon;
            case Address(String s, String c, String z) -> "Address: " + s + ", " + c;
            case Customer(String id, String name, Address addr) -> "Customer: " + name;
            default -> "Unknown";
        };
        
        // Nested record patterns
        Object wrapped = new Wrapper<>(new Coordinate(1.0, 2.0), 12345L);
        if (wrapped instanceof Wrapper(Coordinate(double x, double y), long ts)) {
            double coordSum = x + y;
            long time = ts;
        }
    }
    
    // ========================================================================
    // SECTION 4: USING ENUMS FROM HelperTypes.java
    // ========================================================================
    
    public void usingEnums() {
        // Enum values
        Priority priority = Priority.HIGH;
        HttpStatus status = HttpStatus.OK;
        
        // Enum methods
        int weight = priority.getWeight();
        String desc = priority.getDescription();
        Priority escalated = priority.escalate();
        
        int code = status.getCode();
        String reason = status.getReason();
        boolean isSuccess = status.isSuccess();
        boolean isError = status.isError();
        
        // Switch on external enum
        String priorityText = switch (priority) {
            case LOW -> "Not urgent";
            case MEDIUM -> "Normal";
            case HIGH -> "Important";
            case CRITICAL -> "Emergency";
        };
        
        // Switch with guards on external enum
        String statusCategory = switch (status) {
            case HttpStatus s when s.isSuccess() -> "Success: " + s.getReason();
            case HttpStatus s when s.isError() -> "Error: " + s.getReason();
            default -> "Unknown";
        };
    }
    
    // ========================================================================
    // SECTION 5: USING FUNCTIONAL INTERFACES FROM HelperTypes.java
    // ========================================================================
    
    public void usingFunctionalInterfaces() {
        // Validator interface
        Validator<String> notEmpty = s -> s != null && !s.isEmpty() 
            ? ValidationResult.valid() 
            : ValidationResult.invalid("String is empty");
        
        Validator<String> maxLength = s -> s.length() <= 100
            ? ValidationResult.valid()
            : ValidationResult.invalid("String too long");
        
        // Composed validators
        Validator<String> combined = notEmpty.and(maxLength);
        ValidationResult result = combined.validate("test");
        
        boolean isValid = result.isValid();
        List<String> errors = result.errors();
        
        // ThrowingSupplier
        ThrowingSupplier<String, Exception> supplier = () -> {
            String value = "computed";
            return value;
        };
        
        // ThrowingFunction
        ThrowingFunction<String, Integer, NumberFormatException> parser = s -> {
            int parsed = Integer.parseInt(s);
            return parsed;
        };
    }
    
    // ========================================================================
    // SECTION 6: USING GENERIC UTILITY CLASSES FROM HelperTypes.java
    // ========================================================================
    
    public void usingGenericUtilities() {
        // Either type
        Either<String, Integer> rightEither = Either.right(42);
        Either<String, Integer> leftEither = Either.left("error");
        
        boolean isRight = rightEither.isRight();
        boolean isLeft = leftEither.isLeft();
        Integer rightValue = rightEither.getRight();
        String leftValue = leftEither.getLeft();
        
        // Fold operation
        String folded = rightEither.fold(
            error -> "Error: " + error,
            value -> "Value: " + value
        );
        
        // Lazy type
        Lazy<String> lazyString = new Lazy<>(() -> {
            String computed = "expensive computation";
            return computed;
        });
        
        String lazyValue = lazyString.get();
        
        // Mapped lazy
        Lazy<Integer> mappedLazy = lazyString.map(s -> {
            int length = s.length();
            return length;
        });
        Integer mappedLazyValue = mappedLazy.get();
    }
    
    // ========================================================================
    // SECTION 7: USING SEALED CLASSES FROM HelperTypes.java
    // ========================================================================
    
    public void usingSealedClasses() {
        // Create shapes
        Shape circle = new Circle(5.0);
        Shape rectangle = new Rectangle(4.0, 3.0);
        Shape triangle = new Triangle(3.0, 4.0, 5.0);
        
        // Method calls
        double circleArea = circle.area();
        double circlePerimeter = circle.perimeter();
        
        // Pattern matching on sealed type
        String shapeDesc = switch (circle) {
            case Circle c -> "Circle with radius " + c.getRadius();
            case Rectangle r -> "Rectangle " + r.getWidth() + "x" + r.getHeight();
            case Triangle t -> "Triangle with sides " + t.getA() + "," + t.getB() + "," + t.getC();
        };
        
        // Exhaustive switch (no default needed due to sealed)
        double area = switch (rectangle) {
            case Circle c -> c.area();
            case Rectangle r -> r.area();
            case Triangle t -> t.area();
        };
    }
    
    // ========================================================================
    // SECTION 8: USING REPOSITORY PATTERN FROM HelperTypes.java
    // ========================================================================
    
    public void usingRepositoryPattern() {
        // Create repository with lambda
        Repository<Customer, String> customerRepo = new InMemoryRepository<>(c -> c.id());
        
        // Save operations
        Address addr = new Address("456 Oak Ave", "Boston", "02101");
        Customer newCustomer = new Customer("C002", "Bob", addr);
        Customer saved = customerRepo.save(newCustomer);
        
        // Find operations
        Optional<Customer> found = customerRepo.findById("C002");
        List<Customer> all = customerRepo.findAll();
        
        // Optional handling
        Customer customer = found.orElse(null);
        String name = found.map(c -> c.name()).orElse("Unknown");
        
        // Stream operations on repository results
        List<String> customerNames = all.stream()
            .map(c -> {
                String customerName = c.name();
                return customerName;
            })
            .collect(Collectors.toList());
    }
    
    // ========================================================================
    // SECTION 9: USING EXCEPTION CLASSES FROM HelperTypes.java
    // ========================================================================
    
    public void usingExceptionClasses() {
        try {
            // Simulate some operation
            boolean valid = false;
            if (!valid) {
                List<String> errors = List.of("Field required", "Invalid format");
                ValidationException ve = new ValidationException("Validation failed", errors);
                throw ve;
            }
        } catch (ValidationException e) {
            String message = e.getMessage();
            String errorCode = e.getErrorCode();
            List<String> validationErrors = e.getValidationErrors();
            
            // Process errors
            for (String error : validationErrors) {
                String logged = "Error: " + error;
            }
        } catch (BusinessException e) {
            String code = e.getErrorCode();
        }
        
        try {
            String resourceId = "R001";
            NotFoundException nfe = new NotFoundException("Customer", resourceId);
            throw nfe;
        } catch (NotFoundException e) {
            String resourceType = e.getResourceType();
            String id = e.getResourceId();
        } catch (BusinessException e) {
            // Generic handling
        }
    }
    
    // ========================================================================
    // SECTION 10: COMPLEX SCENARIOS COMBINING MULTIPLE EXTERNAL TYPES
    // ========================================================================
    
    public void complexScenarios() {
        // Nested generics with external types
        HelperTypes.Result<Either<String, Customer>> complexResult = 
            HelperTypes.Result.success(Either.right(new Customer("C003", "Charlie", 
                new Address("789 Pine Rd", "Chicago", "60601"))));
        
        Either<String, Customer> eitherValue = complexResult.getValue();
        
        // Stream with external types
        List<Order> orders = List.of(
            new Order("O001", new Customer("C001", "Alice", 
                new Address("1", "A", "1")), List.of()),
            new Order("O002", new Customer("C002", "Bob", 
                new Address("2", "B", "2")), List.of())
        );
        
        Map<String, Customer> orderCustomers = orders.stream()
            .collect(Collectors.toMap(
                o -> {
                    String orderId = o.orderId();
                    return orderId;
                },
                o -> {
                    Customer c = o.customer();
                    return c;
                }
            ));
        
        // Lazy computation with external types
        Lazy<HelperTypes.Result<String>> lazyResult = new Lazy<>(() -> {
            String computed = "lazy value";
            HelperTypes.Result<String> result = HelperTypes.Result.success(computed);
            return result;
        });
        
        // Validator chain with external types
        Validator<Customer> hasName = c -> c.name() != null && !c.name().isEmpty()
            ? ValidationResult.valid()
            : ValidationResult.invalid("Customer must have name");
        
        Validator<Customer> hasAddress = c -> c.address() != null
            ? ValidationResult.valid()
            : ValidationResult.invalid("Customer must have address");
        
        Validator<Customer> customerValidator = hasName.and(hasAddress);
        
        Customer testCustomer = new Customer("C004", "Diana", 
            new Address("100 Elm St", "Denver", "80201"));
        ValidationResult validation = customerValidator.validate(testCustomer);
    }
}
