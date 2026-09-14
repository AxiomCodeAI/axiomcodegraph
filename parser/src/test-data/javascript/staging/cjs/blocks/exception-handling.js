// fixture: cjs/blocks/exception-handling.js
// module system: CommonJS  (governing: staging/cjs/package.json, "type": "commonjs")
// nature: runtime-bearing
// syntax floor: ES2019 (optional catch binding); ES2022 for `cause`
//
// Port of java/blocks/AdvancedExceptionHandling.java and
// ComprehensiveExceptionPatterns.java. Block kinds TRY, CATCH, FINALLY.
//
// NO ANALOGUE — Java's `throws` clause. JavaScript has no checked exceptions and
// no throws clause, exactly as TypeScript does not. Java's entire ThrowsPatterns.java
// and the THROWS_CLAUSE type-reference context have no port and none is invented.
// The nearest thing JavaScript has is the JSDoc @throws tag, which is a comment
// with no enforcement, and it is covered in jsdoc/param-returns.js.
//
// ALSO NO ANALOGUE — multi-catch `catch (A | B e)` and any typed catch
// parameter. A catch binding has no type and no annotation channel; the type is
// recovered by `instanceof` narrowing, which is what is covered instead.
//
// What JavaScript has that Java does not: throwing a non-Error (any value at
// all), an optional catch binding that declares nothing, and `finally` that can
// swallow a throw by returning.

'use strict';

// The Error subclass hierarchy that replaces Java's checked-exception types.
class AppError extends Error {
  constructor(message, options) {
    super(message, options);        // `options.cause` — [ES2022]
    this.name = 'AppError';
    // Error subclasses need this to get a useful stack in V8, and it is a
    // static method call whose receiver is a builtin.
    Error.captureStackTrace(this, AppError);
  }
}

class NotFoundError extends AppError {
  constructor(resource) {
    super('not found: ' + resource);
    this.name = 'NotFoundError';
    this.resource = resource;
  }
}

class ValidationError extends AppError {
  constructor(field, cause) {
    super('invalid: ' + field, { cause });
    this.name = 'ValidationError';
    this.field = field;
  }
}

function basic(fn) {
  try {
    return fn();
  } catch (err) {
    return err.message;
  } finally {
    // Runs on every path, including the return above.
  }
}

// try/catch with no finally, try/finally with no catch, and a bare try/finally
// whose finally RETURNS — which discards the in-flight exception entirely.
function tryFinallyOnly(fn) {
  try {
    return fn();
  } finally {
    return 'finally wins';
  }
}

// Optional catch binding: no parameter at all, so nothing is declared.
function swallow(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

// A destructured catch binding. The parameter is a pattern, not a name, so
// bindingForm is OBJECT_PATTERN and it binds two names.
function destructuredCatch(fn) {
  try {
    return fn();
  } catch ({ message, code = 'UNKNOWN' }) {
    return code + ':' + message;
  }
}

// The multi-catch replacement: one catch, `instanceof` narrowing inside.
function narrowing(fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NotFoundError) { return 404; }
    if (err instanceof ValidationError) { return 422; }
    if (err instanceof AppError) { return 500; }
    if (err instanceof TypeError || err instanceof RangeError) { return 400; }
    // A non-Error throw lands here, and `err.message` would be undefined.
    if (typeof err === 'string') { return err; }
    throw err;                       // rethrow: the same value, a new throw site
  }
}

// Throwing values that are not Errors. Legal, and it means a catch parameter's
// shape is unknown even by convention.
function throwsAnything(kind) {
  switch (kind) {
    case 'string': throw 'a string';
    case 'number': throw 42;
    case 'object': throw { code: 'E_PLAIN' };
    case 'null': throw null;
    case 'error': throw new NotFoundError('user');
    default: throw new Error('unknown', { cause: new Error('root') });
  }
}

// Nested try, rethrow with a cause chain, and a catch that throws a DIFFERENT
// error — three throw sites for one failure.
function wrapping(fn) {
  try {
    try {
      return fn();
    } catch (inner) {
      throw new ValidationError('field', inner);
    }
  } catch (outer) {
    throw new AppError('wrapped', { cause: outer });
  } finally {
    // A `continue`/`break`/`return` here would discard the throw; a bare
    // statement does not.
  }
}

// try inside a loop, and a catch that continues.
function resilientLoop(tasks) {
  const results = [];
  for (const task of tasks) {
    try {
      results.push(task());
    } catch (err) {
      results.push(null);
      continue;
    } finally {
      results.push('done');
    }
  }
  return results;
}

// async/await: try around an await, and the promise-chain equivalent, which is
// the same control flow with no try block at all.
async function asyncTry(promise) {
  try {
    return await promise;
  } catch (err) {
    return null;
  } finally {
    await Promise.resolve();
  }
}

function promiseChain(promise) {
  return promise
    .then((value) => value)
    .catch((err) => null)
    .finally(() => undefined);
}

// A generator with a try/finally: the finally runs when the iterator's return()
// is called, which is a resumption from outside the function.
function* generatorTry(items) {
  try {
    for (const item of items) { yield item; }
  } finally {
    items.length = 0;
  }
}

// An unhandled rejection and a process-level handler — the two places a throw
// goes when nothing catches it.
process.on('uncaughtException', (err) => { return err; });
process.on('unhandledRejection', (reason) => { return reason; });

module.exports = {
  AppError, NotFoundError, ValidationError,
  basic, tryFinallyOnly, swallow, destructuredCatch, narrowing,
  throwsAnything, wrapping, resilientLoop, asyncTry, promiseChain, generatorTry
};
