/**
 * Retry configuration options
 */
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  exponentialBackoff?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1500,
  exponentialBackoff: true,
  onRetry: () => {},
};

/**
 * Decorator function that retries the wrapped function on failure
 * 
 * @param fn Function to wrap with retry logic
 * @param options Retry configuration options
 * @returns Wrapped function with retry capability
 */
export function withRetry<T extends (...args: any[]) => any>(
  fn: T,
  options: RetryOptions = {}
): T {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };

  return ((...args: Parameters<T>): ReturnType<T> => {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return fn(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < config.maxAttempts) {
          config.onRetry(attempt, lastError);
          
          // Calculate delay with optional exponential backoff
          const delay = config.exponentialBackoff 
            ? config.delayMs * Math.pow(2, attempt - 1)
            : config.delayMs;
          
          // Synchronous delay (blocking)
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait - not ideal but works for small delays
          }
        }
      }
    }
    
    throw lastError;
  }) as T;
}

/**
 * Async version of retry decorator for promise-based functions
 * 
 * @param fn Async function to wrap with retry logic
 * @param options Retry configuration options
 * @returns Wrapped async function with retry capability
 */
export async function withRetryAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: RetryOptions = {}
): Promise<(...args: Parameters<T>) => ReturnType<T>> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options };

  return (async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < config.maxAttempts) {
          config.onRetry(attempt, lastError);
          
          // Calculate delay with optional exponential backoff
          const delay = config.exponentialBackoff 
            ? config.delayMs * Math.pow(2, attempt - 1)
            : config.delayMs;
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }) as (...args: Parameters<T>) => ReturnType<T>;
}
