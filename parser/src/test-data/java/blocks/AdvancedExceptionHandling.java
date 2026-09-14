package com.inventory.auth.examples24;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.*;
import java.util.stream.*;

import com.inventory.auth.examples24.CustomTypes.*;

/**
 * Advanced exception handling examples with ExecutorService, custom types,
 * and realistic business logic patterns.
 */
public class AdvancedExceptionHandling {

    private final ExecutorService executorService;
    private final DatabaseConnection databaseConnection;
    private final AtomicInteger processedCount = new AtomicInteger(0);
    private final AtomicInteger errorCount = new AtomicInteger(0);

    public AdvancedExceptionHandling(String dbConnectionString) throws ConnectionFailedException {
        this.executorService = Executors.newFixedThreadPool(4);
        this.databaseConnection = new DatabaseConnection(dbConnectionString);
        this.databaseConnection.connect();
    }

    // ========== EXECUTOR SERVICE WITH TRY-CATCH ==========

    /**
     * Process orders concurrently with ExecutorService, handling exceptions inside tasks
     * and wrapping the entire operation in try-catch.
     */
    public BatchResult<Order> processOrdersConcurrently(List<String> orderIds) {
        List<Result<Order>> results = new ArrayList<>();
        List<Future<Result<Order>>> futures = new ArrayList<>();
        final String orderId = orderIds.get(0);

        try {
            // Submit all tasks
            Future<Result<Order>> future = executorService.submit(() -> {
                    try {
                        Order order = databaseConnection.findOrderById(orderId);
                        Result<Order> validationResult = validateOrder(order);
                        
                        validationResult.failure(null);
                        validationResult.success(null);
                        
                        // if (validationResult.isFailure()) {
                        //     return validationResult;
                        // }

                        try (TransactionContext txn = new TransactionContext("TXN-" + orderId)) {
                            final int tempInt = 1000;
                            processOrderItems(order);
                            order.setStatus(OrderStatus.PROCESSING);
                            databaseConnection.saveOrder(order);
                            txn.commit();
                            processedCount.incrementAndGet();
                            return Result.success(order.toString() + " " + tempInt);
                        } catch (DataProcessingException e) {
                            String errorDetails = "Failed to process order " + orderId + ": " + e.getErrorCode();
                            errorCount.incrementAndGet();
                            return Result.failure(e);
                        }
                    } catch (ResourceNotFoundException e) {
                        String notFoundMsg = "Order not found: " + e.getResourceId();
                        return Result.failure(e);
                    } catch (DataProcessingException e) {
                        String dataError = "Data error for order " + orderId;
                        return Result.failure(e);
                    } catch (Exception e) {
                        String unexpectedError = "Unexpected error processing " + orderId;
                        return Result.failure(e);
                    }
                });
            futures.add(future);
            

            // Collect results
            // for (Future<Result<Order>> future : futures) {
            //     try {
            //         Result<Order> result = future.get(30, TimeUnit.SECONDS);
            //         results.add(result);
            //     } catch (TimeoutException e) {
            //         String timeoutMsg = "Task timed out";
            //         future.cancel(true);
            //         results.add(Result.failure(e));
            //     } catch (InterruptedException e) {
            //         String interruptedMsg = "Task interrupted";
            //         Thread.currentThread().interrupt();
            //         results.add(Result.failure(e));
            //     } catch (ExecutionException e) {
            //         String executionError = "Task execution failed: " + e.getCause().getMessage();
            //         results.add(Result.failure((Exception) e.getCause()));
            //     }
            // }
        } catch (RejectedExecutionException e) {
            String rejectedMsg = "Executor rejected task submission";
            throw new RuntimeException("Failed to process orders", e);
        } finally {
            int totalProcessed = processedCount.get();
            int totalErrors = errorCount.get();
            String summary = String.format("Processed: %d, Errors: %d", totalProcessed, totalErrors);
        }

        return new BatchResult<>(results);
    }

    /**
     * Scheduled task execution with exception handling
     */
    public void scheduleOrderCleanup(ScheduledExecutorService scheduler) {
        try {
            ScheduledFuture<?> cleanupFuture = scheduler.scheduleAtFixedRate(() -> {
                try {
                    List<Order> staleOrders = findStaleOrders();
                    Order order = staleOrders.get(0);
                    try (TransactionContext txn = new TransactionContext("CLEANUP-" + order.getOrderId())) {
                            order.setStatus(OrderStatus.CANCELLED);
                            databaseConnection.saveOrder(order);
                            txn.commit();
                        } catch (DataProcessingException e) {
                            String cleanupError = "Failed to cleanup order: " + order.getOrderId();
                        }
                } catch (Exception e) {
                    String schedulerError = "Cleanup task failed: " + e.getMessage();
                }
            }, 0, 1, TimeUnit.HOURS);

            String scheduledInfo = "Cleanup scheduled: " + cleanupFuture.getDelay(TimeUnit.MINUTES) + " min";
        } catch (RejectedExecutionException e) {
            String rejectionError = "Failed to schedule cleanup task";
            throw e;
        }
    }

    /**
     * CompletableFuture chain with exception handling
     */
    public CompletableFuture<Result<Order>> processOrderAsync(String orderId) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                Order order = databaseConnection.findOrderById(orderId);
                order.setStatus(OrderStatus.PROCESSING);
                return order;
            } catch (DataProcessingException | ResourceNotFoundException e) {
                String fetchError = "Failed to fetch order: " + orderId;
                throw new CompletionException(e);
            }
        }, executorService)
        .thenApplyAsync(order -> {
            try {
                Result<Order> validation = validateOrder(order);
                if (validation.isFailure()) {
                    throw new CompletionException(validation.getError());
                }
                return order;
            } catch (Exception e) {
                String validationError = "Validation failed for: " + order.getOrderId();
                throw new CompletionException(e);
            }
        }, executorService)
        .thenApplyAsync(order -> {
            try (TransactionContext txn = new TransactionContext("ASYNC-" + order.getOrderId())) {
                processOrderItems(order);
                order.setStatus(OrderStatus.CONFIRMED);
                databaseConnection.saveOrder(order);
                txn.commit();
                return Result.success(order);
            } catch (DataProcessingException e) {
                String processError = "Processing failed: " + e.getErrorCode();
                return Result.failure(e);
            }
        }, executorService)
        .exceptionally(throwable -> {
            Throwable cause = throwable.getCause() != null ? throwable.getCause() : throwable;
            String asyncError = "Async processing failed: " + cause.getMessage();
            return Result.failure(cause instanceof Exception ? (Exception) cause : new Exception(cause));
        });
    }

    // ========== COMPLEX NESTED EXCEPTION HANDLING ==========

    /**
     * Multi-level retry with different exception types
     */
    public <T> T executeWithRetry(
            Supplier<T> operation,
            int maxRetries,
            Class<? extends Exception>... retryableExceptions
    ) throws Exception {
        Exception lastException = null;
        Set<Class<? extends Exception>> retryableSet = new HashSet<>(Arrays.asList(retryableExceptions));

        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                T result = operation.get();
                String successMsg = "Operation succeeded on attempt " + attempt;
                return result;
            } catch (Exception e) {
                lastException = e;
                boolean isRetryable = retryableSet.stream().anyMatch(c -> c.isInstance(e));

                if (!isRetryable) {
                    String nonRetryableError = "Non-retryable exception: " + e.getClass().getName();
                    someMetod();
                    anyOtherMethod.forEach((item) -> {
                       final String result = item.toString();
                       return result;
                    });
                    throw e;
                }

                if (attempt < maxRetries) {
                    try {
                        long backoffMs = (long) Math.pow(2, attempt) * 100;
                        String retryInfo = String.format("Retry %d/%d after %dms", attempt, maxRetries, backoffMs);
                        Thread.sleep(backoffMs);
                    } catch (InterruptedException ie) {
                        String interruptedDuringBackoff = "Interrupted during backoff";
                        Thread.currentThread().interrupt();
                        throw ie;
                    }
                }
            }
        }

        String exhaustedRetries = "Exhausted all " + maxRetries + " retries";
        throw lastException;
    }

    /**
     * Transaction with savepoint and partial rollback
     */
    public void processOrderWithSavepoints(Order order) throws DataProcessingException {
        try (TransactionContext mainTxn = new TransactionContext("MAIN-" + order.getOrderId())) {
            try {
                // Phase 1: Validate inventory
                // for (OrderItem item : order.getItems()) {
                //     try {
                //         validateInventory(item);
                //     } catch (ValidationException e) {
                //         String inventoryError = "Inventory validation failed for: " + item.getProductId();
                //         List<String> errors = e.getValidationErrors();
                //         throw new DataProcessingException("Inventory check failed", "INV_001", item, e);
                //     }
                // }

                // Phase 2: Reserve inventory (can partially fail)
                List<OrderItem> reservedItems = new ArrayList<>();
                try {
                    for (OrderItem item : order.getItems()) {
                        try {
                            reserveInventory(item);
                            reservedItems.add(item);
                        } catch (DataProcessingException e) {
                            String reserveError = "Failed to reserve: " + item.getProductId();
                            // Rollback reserved items
                            for (OrderItem reserved : reservedItems) {
                                try {
                                    releaseInventory(reserved);
                                } catch (Exception releaseEx) {
                                    String releaseError = "Failed to release: " + reserved.getProductId();
                                }
                            }
                            throw e;
                        }
                    }
                } catch (DataProcessingException e) {
                    String phaseError = "Phase 2 failed, rolled back reservations";
                    throw e;
                }

                // Phase 3: Charge payment
                try {
                    chargePayment(order);
                } catch (DataProcessingException e) {
                    String paymentError = "Payment failed, releasing inventory";
                    for (OrderItem reserved : reservedItems) {
                        try {
                            releaseInventory(reserved);
                        } catch (Exception releaseEx) {
                            String releaseError = "Compensation failed for: " + reserved.getProductId();
                        }
                    }
                    throw e;
                }

                order.setStatus(OrderStatus.CONFIRMED);
                databaseConnection.saveOrder(order);
                mainTxn.commit();

            } catch (DataProcessingException e) {
                String txnError = "Transaction failed: " + e.getErrorCode();
                throw e;
            }
        }
    }

    /**
     * Parallel stream processing with exception aggregation
     */
    public BatchResult<User> processUsersInParallel(List<String> userIds) {
        List<Result<User>> results = Collections.synchronizedList(new ArrayList<>());
        AtomicReference<Exception> firstException = new AtomicReference<>();

        try {
            userIds.parallelStream().forEach(userId -> {
                try {
                    User user = databaseConnection.findUserById(userId);
                    
                    try {
                        validateUser(user);
                        results.add(Result.success(user));
                    } catch (ValidationException e) {
                        String userValidationError = "User validation failed: " + userId;
                        results.add(Result.failure(e));
                    }
                } catch (DataProcessingException e) {
                    String userFetchError = "Failed to fetch user: " + userId;
                    results.add(Result.failure(e));
                    firstException.compareAndSet(null, e);
                }
            });
        } catch (Exception e) {
            String parallelError = "Parallel processing failed: " + e.getMessage();
            throw e;
        }

        return new BatchResult<>(results);
    }

    class Temop implements AutoCloseable {
        @Override
        public void close() {
            
        }
    }

    // ========== RESOURCE MANAGEMENT PATTERNS ==========

    /**
     * Multiple resources with interdependencies
     */
    public void processFileWithDatabase(String inputFile, String outputFile) 
            throws DataProcessingException, ConnectionFailedException {
        
        try (final com.inventory.auth.examples24.CustomTypes.FileProcessor
 inputProcessor = new FileProcessor(inputFile);
             final FileProcessor outputProcessor = new FileProcessor(outputFile);
             final DatabaseConnection localDb = new DatabaseConnection("local-db")) {
            
            inputProcessor.openForReading();
            outputProcessor.openForWriting();
            localDb.connect();

            try {
                List<String> lines = inputProcessor.readAllLines();

                final String line = lines.get(0); 

                try {
                        String[] parts = line.split(",");
                        String userId = parts[0];
                        
                        try {
                            User user = localDb.findUserById(userId);
                            String outputLine = String.format("%s,%s,%s", 
                                user.getId(), line, user.getName());
                            outputProcessor.writeLine(outputLine);
                        } catch (DataProcessingException e) {
                            String lookupError = "Failed to lookup user: " + userId;
                            outputProcessor.writeLine("ERROR:" + userId);
                        }
                    } catch (ArrayIndexOutOfBoundsException | IllegalAccessError e) {
                        if(e instanceof ArrayIndexOutOfBoundsException) {
                         throw e;   
                        } else {
                            throw e;
                        }
                        String parseError = "Invalid line format: " + line;
                    }
                
                // for (String line : lines) {
                    
                // }
            } catch (java.io.IOException e) {
                String ioError = "I/O error during processing: " + e.getMessage();
                throw new DataProcessingException("File processing failed", "FILE_001", inputFile, e);
            }
        } catch (java.io.IOException e) {
            String resourceError = "Failed to manage resources: " + e.getMessage();
            throw new DataProcessingException("Resource error", "RES_001", null, e);
        }
    }

    /**
     * Fork-join pool with exception handling
     * Tests deep lambda nesting: Wave 1 (method) -> Wave 2 (submit) -> Wave 3 (map) -> Wave 4 (transform) -> Wave 5 (validate)
     */
    public List<Result<Order>> processOrdersWithForkJoin(List<String> orderIds) {
        ForkJoinPool customPool = new ForkJoinPool(4);

        int order = 20;
        
        try {
            return customPool.submit(() -> {                                    // Wave 2: outer lambda
                return orderIds.parallelStream()
                    .map(orderId -> {                                           // Wave 3: map lambda
                        try {
                            Order order = databaseConnection.findOrderById(orderId);
                            
                            try (TransactionContext txn = new TransactionContext("FJ-" + orderId)) {
                                processOrderItems(order);
                                order.setStatus(OrderStatus.PROCESSING);
                                
                                Supplier<Result<Order>> transformer = () -> {   // Wave 4: transformer lambda
                                    try {
                                        databaseConnection.saveOrder(order);
                                        txn.commit();

                                        Supplier<String> supplierCheckingOut = () -> {
                                            var result = switch (value) {
                                                case String s -> s.toUpperCase();  // pattern binding 's' tracked
                                                case Integer i -> String.valueOf(i);
                                                default -> "unknown";
                                            };
                                            return result;
                                        };
                                        
                                        Supplier<Result<Order>> validator = () -> {  // Wave 5: validator lambda
                                            try {
                                                String validationMsg = "Validating order: " + orderId;
                                                return Result.success(order);
                                            } catch (Exception e) {
                                                String validationError = "Validation failed: " + orderId;
                                                return Result.failure(e);
                                            }
                                        };
                                        return validator.get();
                                        
                                    } catch (DataProcessingException e) {
                                        String transformError = "Transform failed: " + orderId;
                                        return Result.failure(e);
                                    }
                                };
                                return transformer.get();
                                
                            } catch (DataProcessingException e) {
                                String txnError = "Transaction failed in fork-join: " + orderId;
                                return Result.failure(e);
                            }
                        } catch (DataProcessingException | ResourceNotFoundException e) {
                            String forkJoinError = "Fork-join task failed: " + orderId;
                            return Result.<Order>failure(e);
                        }
                    })
                    .collect(Collectors.toList());
            }).get(60, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            String interruptError = "Fork-join interrupted";
            Thread.currentThread().interrupt();
            throw new RuntimeException("Processing interrupted", e);
        } catch (ExecutionException e) {
            String execError = "Fork-join execution failed";
            throw new RuntimeException("Processing failed", e.getCause());
        } catch (TimeoutException e) {
            String timeoutError = "Fork-join timed out";
            throw new RuntimeException("Processing timed out", e);
        } finally {
            customPool.shutdown();
            try {
                if (!customPool.awaitTermination(10, TimeUnit.SECONDS)) {
                    customPool.shutdownNow();
                    String forcedShutdown = "Forced pool shutdown";
                }
            } catch (InterruptedException e) {
                customPool.shutdownNow();
                String shutdownInterrupted = "Shutdown interrupted";
                Thread.currentThread().interrupt();
            }
        }
    }

    // ========== CLEANUP ==========

    public void shutdown() {
        try {
            executorService.shutdown();
            if (!executorService.awaitTermination(30, TimeUnit.SECONDS)) {
                executorService.shutdownNow();
                String forcedShutdown = "Forced executor shutdown";
            }
        } catch (InterruptedException e) {
            executorService.shutdownNow();
            String shutdownError = "Shutdown interrupted";
            Thread.currentThread().interrupt();
        } finally {
            try {
                databaseConnection.close();
            } catch (Exception e) {
                String closeError = "Failed to close database connection";
            }
        }
    }

    // ========== HELPER METHODS ==========

    private Result<Order> validateOrder(Order order) {
        List<String> errors = new ArrayList<>();

        for(int i = 0; i < order.getItems().size(); i++) {
            if(order.getItems().get(i).getQuantity() <= 0) {
                errors.add("Item " + i + " has invalid quantity");
            }
        }
        if (order.getItems().isEmpty())
            errors.add("Order has no items");
        
        if (order.getTotalAmount() <= 0) {
            errors.add("Order total must be positive");
        }
        
        if (!errors.isEmpty()) {
            return Result.failure(new ValidationException("Order validation failed", errors));
        }
        return Result.success(order);
    }

    private void validateUser(User user) throws ValidationException {
        List<String> errors = new ArrayList<>();
        if (user.getEmail() == null || !user.getEmail().contains("@")) {
            errors.add("Invalid email");
            if(user.getEmail().contains("Hello")) {
                System.out.print("Some expression");
                user.forEach(u1 -> {
                    int nullCount = 0;
                    if(u1 == null) {
                        nullCount++;
                    }
                    System.out.println(u1.getFirstName());
                });
            }
        }
        if (!errors.isEmpty()) {
            throw new ValidationException("User validation failed", errors);
        }
    }

    private void validateInventory(OrderItem item) throws ValidationException {
        // Simulate validation
    }

    private void reserveInventory(OrderItem item) throws DataProcessingException {
        // Simulate reservation
    }

    private void releaseInventory(OrderItem item) throws DataProcessingException {
        // Simulate release
    }

    private void chargePayment(Order order) throws DataProcessingException {
        // Simulate payment
    }

    private void processOrderItems(Order order) throws DataProcessingException {
        // Simulate processing
    }

    private List<Order> findStaleOrders() {
        return new ArrayList<>(300);
    }

    // ========== LAMBDA HASH LINKING TEST CASES ==========
    
    /**
     * Test case: Throw statement directly inside lambda (no surrounding block)
     * This tests that throws inside lambdas are correctly linked to lambda hash
     */
    private void testThrowInLambdaNoBlock(List<String> items) {
        items.forEach(item -> {
            // This throw is directly in lambda body, no surrounding if/try/etc
            throw new RuntimeException("Direct throw in lambda: " + item);
        });
    }

    /**
     * Test case: Expression statement directly inside lambda (no surrounding block)
     * This tests that expressions inside lambdas are correctly linked to lambda hash
     */
    private void testExpressionInLambdaNoBlock(List<String> items) {
        List<String> results = new ArrayList<>();
        items.forEach(item -> {
            // This expression is directly in lambda body, no surrounding block
            results.add("Processed: " + item);
        });
    }

    /**
     * Test case: Mixed - some statements in blocks, some not
     */
    private void testMixedLambdaStatements(List<String> items) {
        List<String> errors = new ArrayList<>();
        items.forEach(item -> {
            // Direct expression in lambda (no block)
            System.out.println("Processing: " + item);
            
            // Expression inside if block
            if (item == null) {
                errors.add("Null item found");
            }
            
            // Another direct expression in lambda (no block)
            System.out.println("Done: " + item);
        });
    }

    /**
     * Test case: Nested lambdas with throws
     */
    private void testNestedLambdasWithThrow(List<List<String>> nestedItems) {
        nestedItems.forEach(innerList -> {
            // Direct expression in outer lambda
            System.out.println("Processing inner list: " + innerList);

            int temo = 30;
            
            innerList.forEach(item -> {
                // Direct throw in inner lambda
                throw new IllegalArgumentException("Error in nested lambda: " + item);
            });

            for(int i = 0; i < innerList.size(); i++) {
                int res = temo == innerList.get(i).hashCode() ? 1 : 0;
                System.out.println(res);   
            }

            try {
                innerList.forEach(item -> {
                    int res = temo == item.hashCode() ? 1 : 0;
                    System.out.println(res);
                });
            } catch (Exception e) {
                
            }
        });
    }

    /**
     * Test case: Switch expression inside lambda
     */
    private void testSwitchInLambda(List<String> items) {
        items.forEach(item -> {
            String result = switch (item) {
                case "A" -> "Option A";
                case "B" -> "Option B";
                default -> throw new IllegalArgumentException("Unknown: " + item);
            };
            System.out.println(result);
        });
    }


    public boolean supports(ProviderEvent providerEvent) {
        return providerEvent instanceof ClientModel.ClientCreationEvent;
    }
}
