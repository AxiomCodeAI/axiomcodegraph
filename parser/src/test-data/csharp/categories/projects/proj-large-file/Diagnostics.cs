// OVER THE 32,767-CHARACTER LIMIT, ON PURPOSE.
//
// tree-sitter's default parse path THROWS above 32,767 characters. It does not
// truncate, and it does not warn: it throws, and a parser without the
// callback-based read in `src/parsers/java/java-parser.ts` emits NOTHING for
// this file. 8.51% of the measured C# corpus is over the limit, so that
// workaround is the common path for real code and not an edge case.
//
// This file is shaped like the large files that actually exist — a diagnostic
// and resource catalogue, which is what the generated string tables of a runtime,
// a compiler and an ORM all are, and they are among the largest files in each.
// Nothing here is filler in the
// sense of being unparseable junk: every declaration is a real declaration, and
// the members AFTER the 32,767th character are the measurement.
//
// What to check, in increasing order of strictness:
//   1. the file produces a cs_module row at all;
//   2. `DiagnosticCatalogue` and all its members are present;
//   3. the three types declared at the END of the file — `LateDeclaration`,
//      `ILateInterface` and `LateRecord` — are present. They sit well past the
//      boundary, and their absence is exactly what a missing callback read
//      looks like: a plausible, non-empty, WRONG answer.
//
// Exact offsets are recorded in ../MANIFEST.md and re-derivable with
// `wc -c` plus a grep for the marker comments below.
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace Fixtures.LargeFile;

/// <summary>Severity of a catalogued diagnostic.</summary>
public enum DiagnosticSeverity
{
    /// <summary>Informational only; the operation succeeded.</summary>
    Information,

    /// <summary>The operation succeeded with a caveat worth surfacing.</summary>
    Warning,

    /// <summary>The operation failed and may be retried.</summary>
    Transient,

    /// <summary>The operation failed and will fail again if repeated.</summary>
    Permanent,
}

/// <summary>A single catalogued diagnostic.</summary>
/// <param name="Name">The stable member name.</param>
/// <param name="Code">The stable wire code.</param>
/// <param name="Message">The human-readable message.</param>
/// <param name="Status">The HTTP status this diagnostic maps to.</param>
/// <param name="Severity">Whether a retry could succeed.</param>
public sealed record DiagnosticDescriptor(
    string Name,
    string Code,
    string Message,
    int Status,
    DiagnosticSeverity Severity)
{
    /// <summary>True when a caller may reasonably retry.</summary>
    public bool IsRetryable => Severity == DiagnosticSeverity.Transient;

    /// <inheritdoc />
    public override string ToString() => $"{Code}: {Message}";
}

/// <summary>
/// The catalogue. Deliberately large: this type alone carries the file past the
/// 32,767-character boundary, and the declarations after it are what a parser
/// missing the callback read silently drops.
/// </summary>
public static class DiagnosticCatalogue
{
    /// <summary>Value cannot be null.</summary>
    public const string ArgumentNullMessage = "Value cannot be null.";

    /// <summary>Stable wire code for <see cref="ArgumentNullMessage"/>.</summary>
    public const string ArgumentNullCode = "ARG0001";

    /// <summary>Value was out of the expected range.</summary>
    public const string ArgumentOutOfRangeMessage = "Value was out of the expected range.";

    /// <summary>Stable wire code for <see cref="ArgumentOutOfRangeMessage"/>.</summary>
    public const string ArgumentOutOfRangeCode = "ARG0002";

    /// <summary>Value cannot be an empty string.</summary>
    public const string ArgumentEmptyMessage = "Value cannot be an empty string.";

    /// <summary>Stable wire code for <see cref="ArgumentEmptyMessage"/>.</summary>
    public const string ArgumentEmptyCode = "ARG0003";

    /// <summary>Value cannot consist only of white-space characters.</summary>
    public const string ArgumentWhitespaceMessage = "Value cannot consist only of white-space characters.";

    /// <summary>Stable wire code for <see cref="ArgumentWhitespaceMessage"/>.</summary>
    public const string ArgumentWhitespaceCode = "ARG0004";

    /// <summary>Value must be greater than zero.</summary>
    public const string ArgumentNotPositiveMessage = "Value must be greater than zero.";

    /// <summary>Stable wire code for <see cref="ArgumentNotPositiveMessage"/>.</summary>
    public const string ArgumentNotPositiveCode = "ARG0005";

    /// <summary>Value must be a finite number.</summary>
    public const string ArgumentNotFiniteMessage = "Value must be a finite number.";

    /// <summary>Stable wire code for <see cref="ArgumentNotFiniteMessage"/>.</summary>
    public const string ArgumentNotFiniteCode = "ARG0006";

    /// <summary>The supplied value is not in a recognised format.</summary>
    public const string ArgumentBadFormatMessage = "The supplied value is not in a recognised format.";

    /// <summary>Stable wire code for <see cref="ArgumentBadFormatMessage"/>.</summary>
    public const string ArgumentBadFormatCode = "ARG0007";

    /// <summary>An item with the same key has already been added.</summary>
    public const string ArgumentDuplicateMessage = "An item with the same key has already been added.";

    /// <summary>Stable wire code for <see cref="ArgumentDuplicateMessage"/>.</summary>
    public const string ArgumentDuplicateCode = "ARG0008";

    /// <summary>Operation is not valid due to the current state.</summary>
    public const string InvalidOperationMessage = "Operation is not valid due to the current state.";

    /// <summary>Stable wire code for <see cref="InvalidOperationMessage"/>.</summary>
    public const string InvalidOperationCode = "OPS0001";

    /// <summary>The operation was cancelled.</summary>
    public const string OperationCancelledMessage = "The operation was cancelled.";

    /// <summary>Stable wire code for <see cref="OperationCancelledMessage"/>.</summary>
    public const string OperationCancelledCode = "OPS0002";

    /// <summary>The operation timed out.</summary>
    public const string OperationTimedOutMessage = "The operation timed out.";

    /// <summary>Stable wire code for <see cref="OperationTimedOutMessage"/>.</summary>
    public const string OperationTimedOutCode = "OPS0003";

    /// <summary>The operation was superseded by a later request.</summary>
    public const string OperationSupersededMessage = "The operation was superseded by a later request.";

    /// <summary>Stable wire code for <see cref="OperationSupersededMessage"/>.</summary>
    public const string OperationSupersededCode = "OPS0004";

    /// <summary>The operation is already in progress.</summary>
    public const string OperationInProgressMessage = "The operation is already in progress.";

    /// <summary>Stable wire code for <see cref="OperationInProgressMessage"/>.</summary>
    public const string OperationInProgressCode = "OPS0005";

    /// <summary>The operation has not been started.</summary>
    public const string OperationNotStartedMessage = "The operation has not been started.";

    /// <summary>Stable wire code for <see cref="OperationNotStartedMessage"/>.</summary>
    public const string OperationNotStartedCode = "OPS0006";

    /// <summary>The requested resource was not found.</summary>
    public const string NotFoundMessage = "The requested resource was not found.";

    /// <summary>Stable wire code for <see cref="NotFoundMessage"/>.</summary>
    public const string NotFoundCode = "RES0001";

    /// <summary>The requested resource was not found in the given scope.</summary>
    public const string NotFoundInScopeMessage = "The requested resource was not found in the given scope.";

    /// <summary>Stable wire code for <see cref="NotFoundInScopeMessage"/>.</summary>
    public const string NotFoundInScopeCode = "RES0002";

    /// <summary>The requested resource is no longer available.</summary>
    public const string GoneMessage = "The requested resource is no longer available.";

    /// <summary>Stable wire code for <see cref="GoneMessage"/>.</summary>
    public const string GoneCode = "RES0003";

    /// <summary>The requested change conflicts with the current state.</summary>
    public const string ConflictMessage = "The requested change conflicts with the current state.";

    /// <summary>Stable wire code for <see cref="ConflictMessage"/>.</summary>
    public const string ConflictCode = "RES0004";

    /// <summary>A precondition for the request was not met.</summary>
    public const string PreconditionFailedMessage = "A precondition for the request was not met.";

    /// <summary>Stable wire code for <see cref="PreconditionFailedMessage"/>.</summary>
    public const string PreconditionFailedCode = "RES0005";

    /// <summary>The supplied payload exceeds the permitted size.</summary>
    public const string PayloadTooLargeMessage = "The supplied payload exceeds the permitted size.";

    /// <summary>Stable wire code for <see cref="PayloadTooLargeMessage"/>.</summary>
    public const string PayloadTooLargeCode = "RES0006";

    /// <summary>Authentication is required.</summary>
    public const string UnauthenticatedMessage = "Authentication is required.";

    /// <summary>Stable wire code for <see cref="UnauthenticatedMessage"/>.</summary>
    public const string UnauthenticatedCode = "SEC0001";

    /// <summary>The caller is not permitted to perform this action.</summary>
    public const string UnauthorizedMessage = "The caller is not permitted to perform this action.";

    /// <summary>Stable wire code for <see cref="UnauthorizedMessage"/>.</summary>
    public const string UnauthorizedCode = "SEC0002";

    /// <summary>The supplied token has expired.</summary>
    public const string TokenExpiredMessage = "The supplied token has expired.";

    /// <summary>Stable wire code for <see cref="TokenExpiredMessage"/>.</summary>
    public const string TokenExpiredCode = "SEC0003";

    /// <summary>The supplied token could not be read.</summary>
    public const string TokenMalformedMessage = "The supplied token could not be read.";

    /// <summary>Stable wire code for <see cref="TokenMalformedMessage"/>.</summary>
    public const string TokenMalformedCode = "SEC0004";

    /// <summary>The signature could not be verified.</summary>
    public const string SignatureInvalidMessage = "The signature could not be verified.";

    /// <summary>Stable wire code for <see cref="SignatureInvalidMessage"/>.</summary>
    public const string SignatureInvalidCode = "SEC0005";

    /// <summary>The supplied token does not carry a sufficient scope.</summary>
    public const string ScopeInsufficientMessage = "The supplied token does not carry a sufficient scope.";

    /// <summary>Stable wire code for <see cref="ScopeInsufficientMessage"/>.</summary>
    public const string ScopeInsufficientCode = "SEC0006";

    /// <summary>The caller has exceeded its quota.</summary>
    public const string QuotaExceededMessage = "The caller has exceeded its quota.";

    /// <summary>Stable wire code for <see cref="QuotaExceededMessage"/>.</summary>
    public const string QuotaExceededCode = "LIM0001";

    /// <summary>Too many requests; retry after the indicated interval.</summary>
    public const string RateLimitedMessage = "Too many requests; retry after the indicated interval.";

    /// <summary>Stable wire code for <see cref="RateLimitedMessage"/>.</summary>
    public const string RateLimitedCode = "LIM0002";

    /// <summary>Too many concurrent operations for this caller.</summary>
    public const string ConcurrencyLimitMessage = "Too many concurrent operations for this caller.";

    /// <summary>Stable wire code for <see cref="ConcurrencyLimitMessage"/>.</summary>
    public const string ConcurrencyLimitCode = "LIM0003";

    /// <summary>The value could not be serialised.</summary>
    public const string SerialisationFailedMessage = "The value could not be serialised.";

    /// <summary>Stable wire code for <see cref="SerialisationFailedMessage"/>.</summary>
    public const string SerialisationFailedCode = "SER0001";

    /// <summary>The value could not be deserialised.</summary>
    public const string DeserialisationFailedMessage = "The value could not be deserialised.";

    /// <summary>Stable wire code for <see cref="DeserialisationFailedMessage"/>.</summary>
    public const string DeserialisationFailedCode = "SER0002";

    /// <summary>The payload does not match the expected schema.</summary>
    public const string SchemaMismatchMessage = "The payload does not match the expected schema.";

    /// <summary>Stable wire code for <see cref="SchemaMismatchMessage"/>.</summary>
    public const string SchemaMismatchCode = "SER0003";

    /// <summary>The payload version is not supported.</summary>
    public const string VersionMismatchMessage = "The payload version is not supported.";

    /// <summary>Stable wire code for <see cref="VersionMismatchMessage"/>.</summary>
    public const string VersionMismatchCode = "SER0004";

    /// <summary>The requested encoding is not supported.</summary>
    public const string EncodingUnsupportedMessage = "The requested encoding is not supported.";

    /// <summary>Stable wire code for <see cref="EncodingUnsupportedMessage"/>.</summary>
    public const string EncodingUnsupportedCode = "SER0005";

    /// <summary>A connection to the remote endpoint could not be opened.</summary>
    public const string ConnectionFailedMessage = "A connection to the remote endpoint could not be opened.";

    /// <summary>Stable wire code for <see cref="ConnectionFailedMessage"/>.</summary>
    public const string ConnectionFailedCode = "NET0001";

    /// <summary>The connection was reset by the remote endpoint.</summary>
    public const string ConnectionResetMessage = "The connection was reset by the remote endpoint.";

    /// <summary>Stable wire code for <see cref="ConnectionResetMessage"/>.</summary>
    public const string ConnectionResetCode = "NET0002";

    /// <summary>The host name could not be resolved.</summary>
    public const string HostUnresolvedMessage = "The host name could not be resolved.";

    /// <summary>Stable wire code for <see cref="HostUnresolvedMessage"/>.</summary>
    public const string HostUnresolvedCode = "NET0003";

    /// <summary>The TLS handshake failed.</summary>
    public const string TlsHandshakeFailedMessage = "The TLS handshake failed.";

    /// <summary>Stable wire code for <see cref="TlsHandshakeFailedMessage"/>.</summary>
    public const string TlsHandshakeFailedCode = "NET0004";

    /// <summary>The configured proxy rejected the request.</summary>
    public const string ProxyRejectedMessage = "The configured proxy rejected the request.";

    /// <summary>Stable wire code for <see cref="ProxyRejectedMessage"/>.</summary>
    public const string ProxyRejectedCode = "NET0005";

    /// <summary>The backing store is unavailable.</summary>
    public const string StorageUnavailableMessage = "The backing store is unavailable.";

    /// <summary>Stable wire code for <see cref="StorageUnavailableMessage"/>.</summary>
    public const string StorageUnavailableCode = "STO0001";

    /// <summary>The backing store is in read-only mode.</summary>
    public const string StorageReadOnlyMessage = "The backing store is in read-only mode.";

    /// <summary>Stable wire code for <see cref="StorageReadOnlyMessage"/>.</summary>
    public const string StorageReadOnlyCode = "STO0002";

    /// <summary>The backing store reported a consistency failure.</summary>
    public const string StorageCorruptMessage = "The backing store reported a consistency failure.";

    /// <summary>Stable wire code for <see cref="StorageCorruptMessage"/>.</summary>
    public const string StorageCorruptCode = "STO0003";

    /// <summary>The transaction was aborted.</summary>
    public const string TransactionAbortedMessage = "The transaction was aborted.";

    /// <summary>Stable wire code for <see cref="TransactionAbortedMessage"/>.</summary>
    public const string TransactionAbortedCode = "STO0004";

    /// <summary>A deadlock was detected and this operation was chosen as the victim.</summary>
    public const string DeadlockDetectedMessage = "A deadlock was detected and this operation was chosen as the victim.";

    /// <summary>Stable wire code for <see cref="DeadlockDetectedMessage"/>.</summary>
    public const string DeadlockDetectedCode = "STO0005";

    /// <summary>A schema migration is pending.</summary>
    public const string MigrationPendingMessage = "A schema migration is pending.";

    /// <summary>Stable wire code for <see cref="MigrationPendingMessage"/>.</summary>
    public const string MigrationPendingCode = "STO0006";

    /// <summary>A required configuration value is missing.</summary>
    public const string ConfigurationMissingMessage = "A required configuration value is missing.";

    /// <summary>Stable wire code for <see cref="ConfigurationMissingMessage"/>.</summary>
    public const string ConfigurationMissingCode = "CFG0001";

    /// <summary>A configuration value could not be parsed.</summary>
    public const string ConfigurationInvalidMessage = "A configuration value could not be parsed.";

    /// <summary>Stable wire code for <see cref="ConfigurationInvalidMessage"/>.</summary>
    public const string ConfigurationInvalidCode = "CFG0002";

    /// <summary>The requested feature is disabled for this caller.</summary>
    public const string FeatureDisabledMessage = "The requested feature is disabled for this caller.";

    /// <summary>Stable wire code for <see cref="FeatureDisabledMessage"/>.</summary>
    public const string FeatureDisabledCode = "CFG0003";

    /// <summary>A required dependency has not been registered.</summary>
    public const string DependencyMissingMessage = "A required dependency has not been registered.";

    /// <summary>Stable wire code for <see cref="DependencyMissingMessage"/>.</summary>
    public const string DependencyMissingCode = "CFG0004";

    /// <summary>An unexpected error occurred.</summary>
    public const string InternalErrorMessage = "An unexpected error occurred.";

    /// <summary>Stable wire code for <see cref="InternalErrorMessage"/>.</summary>
    public const string InternalErrorCode = "INT0001";

    /// <summary>Descriptor for <c>ARG0001</c>.</summary>
    public static DiagnosticDescriptor ArgumentNull { get; } = new DiagnosticDescriptor(
        nameof(ArgumentNull),
        ArgumentNullCode,
        ArgumentNullMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0002</c>.</summary>
    public static DiagnosticDescriptor ArgumentOutOfRange { get; } = new DiagnosticDescriptor(
        nameof(ArgumentOutOfRange),
        ArgumentOutOfRangeCode,
        ArgumentOutOfRangeMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0003</c>.</summary>
    public static DiagnosticDescriptor ArgumentEmpty { get; } = new DiagnosticDescriptor(
        nameof(ArgumentEmpty),
        ArgumentEmptyCode,
        ArgumentEmptyMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0004</c>.</summary>
    public static DiagnosticDescriptor ArgumentWhitespace { get; } = new DiagnosticDescriptor(
        nameof(ArgumentWhitespace),
        ArgumentWhitespaceCode,
        ArgumentWhitespaceMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0005</c>.</summary>
    public static DiagnosticDescriptor ArgumentNotPositive { get; } = new DiagnosticDescriptor(
        nameof(ArgumentNotPositive),
        ArgumentNotPositiveCode,
        ArgumentNotPositiveMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0006</c>.</summary>
    public static DiagnosticDescriptor ArgumentNotFinite { get; } = new DiagnosticDescriptor(
        nameof(ArgumentNotFinite),
        ArgumentNotFiniteCode,
        ArgumentNotFiniteMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0007</c>.</summary>
    public static DiagnosticDescriptor ArgumentBadFormat { get; } = new DiagnosticDescriptor(
        nameof(ArgumentBadFormat),
        ArgumentBadFormatCode,
        ArgumentBadFormatMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>ARG0008</c>.</summary>
    public static DiagnosticDescriptor ArgumentDuplicate { get; } = new DiagnosticDescriptor(
        nameof(ArgumentDuplicate),
        ArgumentDuplicateCode,
        ArgumentDuplicateMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>OPS0001</c>.</summary>
    public static DiagnosticDescriptor InvalidOperation { get; } = new DiagnosticDescriptor(
        nameof(InvalidOperation),
        InvalidOperationCode,
        InvalidOperationMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>OPS0002</c>.</summary>
    public static DiagnosticDescriptor OperationCancelled { get; } = new DiagnosticDescriptor(
        nameof(OperationCancelled),
        OperationCancelledCode,
        OperationCancelledMessage,
        499,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>OPS0003</c>.</summary>
    public static DiagnosticDescriptor OperationTimedOut { get; } = new DiagnosticDescriptor(
        nameof(OperationTimedOut),
        OperationTimedOutCode,
        OperationTimedOutMessage,
        504,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>OPS0004</c>.</summary>
    public static DiagnosticDescriptor OperationSuperseded { get; } = new DiagnosticDescriptor(
        nameof(OperationSuperseded),
        OperationSupersededCode,
        OperationSupersededMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>OPS0005</c>.</summary>
    public static DiagnosticDescriptor OperationInProgress { get; } = new DiagnosticDescriptor(
        nameof(OperationInProgress),
        OperationInProgressCode,
        OperationInProgressMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>OPS0006</c>.</summary>
    public static DiagnosticDescriptor OperationNotStarted { get; } = new DiagnosticDescriptor(
        nameof(OperationNotStarted),
        OperationNotStartedCode,
        OperationNotStartedMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0001</c>.</summary>
    public static DiagnosticDescriptor NotFound { get; } = new DiagnosticDescriptor(
        nameof(NotFound),
        NotFoundCode,
        NotFoundMessage,
        404,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0002</c>.</summary>
    public static DiagnosticDescriptor NotFoundInScope { get; } = new DiagnosticDescriptor(
        nameof(NotFoundInScope),
        NotFoundInScopeCode,
        NotFoundInScopeMessage,
        404,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0003</c>.</summary>
    public static DiagnosticDescriptor Gone { get; } = new DiagnosticDescriptor(
        nameof(Gone),
        GoneCode,
        GoneMessage,
        410,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0004</c>.</summary>
    public static DiagnosticDescriptor Conflict { get; } = new DiagnosticDescriptor(
        nameof(Conflict),
        ConflictCode,
        ConflictMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0005</c>.</summary>
    public static DiagnosticDescriptor PreconditionFailed { get; } = new DiagnosticDescriptor(
        nameof(PreconditionFailed),
        PreconditionFailedCode,
        PreconditionFailedMessage,
        412,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>RES0006</c>.</summary>
    public static DiagnosticDescriptor PayloadTooLarge { get; } = new DiagnosticDescriptor(
        nameof(PayloadTooLarge),
        PayloadTooLargeCode,
        PayloadTooLargeMessage,
        413,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0001</c>.</summary>
    public static DiagnosticDescriptor Unauthenticated { get; } = new DiagnosticDescriptor(
        nameof(Unauthenticated),
        UnauthenticatedCode,
        UnauthenticatedMessage,
        401,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0002</c>.</summary>
    public static DiagnosticDescriptor Unauthorized { get; } = new DiagnosticDescriptor(
        nameof(Unauthorized),
        UnauthorizedCode,
        UnauthorizedMessage,
        403,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0003</c>.</summary>
    public static DiagnosticDescriptor TokenExpired { get; } = new DiagnosticDescriptor(
        nameof(TokenExpired),
        TokenExpiredCode,
        TokenExpiredMessage,
        401,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0004</c>.</summary>
    public static DiagnosticDescriptor TokenMalformed { get; } = new DiagnosticDescriptor(
        nameof(TokenMalformed),
        TokenMalformedCode,
        TokenMalformedMessage,
        401,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0005</c>.</summary>
    public static DiagnosticDescriptor SignatureInvalid { get; } = new DiagnosticDescriptor(
        nameof(SignatureInvalid),
        SignatureInvalidCode,
        SignatureInvalidMessage,
        401,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SEC0006</c>.</summary>
    public static DiagnosticDescriptor ScopeInsufficient { get; } = new DiagnosticDescriptor(
        nameof(ScopeInsufficient),
        ScopeInsufficientCode,
        ScopeInsufficientMessage,
        403,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>LIM0001</c>.</summary>
    public static DiagnosticDescriptor QuotaExceeded { get; } = new DiagnosticDescriptor(
        nameof(QuotaExceeded),
        QuotaExceededCode,
        QuotaExceededMessage,
        429,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>LIM0002</c>.</summary>
    public static DiagnosticDescriptor RateLimited { get; } = new DiagnosticDescriptor(
        nameof(RateLimited),
        RateLimitedCode,
        RateLimitedMessage,
        429,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>LIM0003</c>.</summary>
    public static DiagnosticDescriptor ConcurrencyLimit { get; } = new DiagnosticDescriptor(
        nameof(ConcurrencyLimit),
        ConcurrencyLimitCode,
        ConcurrencyLimitMessage,
        429,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>SER0001</c>.</summary>
    public static DiagnosticDescriptor SerialisationFailed { get; } = new DiagnosticDescriptor(
        nameof(SerialisationFailed),
        SerialisationFailedCode,
        SerialisationFailedMessage,
        500,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SER0002</c>.</summary>
    public static DiagnosticDescriptor DeserialisationFailed { get; } = new DiagnosticDescriptor(
        nameof(DeserialisationFailed),
        DeserialisationFailedCode,
        DeserialisationFailedMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SER0003</c>.</summary>
    public static DiagnosticDescriptor SchemaMismatch { get; } = new DiagnosticDescriptor(
        nameof(SchemaMismatch),
        SchemaMismatchCode,
        SchemaMismatchMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SER0004</c>.</summary>
    public static DiagnosticDescriptor VersionMismatch { get; } = new DiagnosticDescriptor(
        nameof(VersionMismatch),
        VersionMismatchCode,
        VersionMismatchMessage,
        400,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>SER0005</c>.</summary>
    public static DiagnosticDescriptor EncodingUnsupported { get; } = new DiagnosticDescriptor(
        nameof(EncodingUnsupported),
        EncodingUnsupportedCode,
        EncodingUnsupportedMessage,
        415,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>NET0001</c>.</summary>
    public static DiagnosticDescriptor ConnectionFailed { get; } = new DiagnosticDescriptor(
        nameof(ConnectionFailed),
        ConnectionFailedCode,
        ConnectionFailedMessage,
        502,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>NET0002</c>.</summary>
    public static DiagnosticDescriptor ConnectionReset { get; } = new DiagnosticDescriptor(
        nameof(ConnectionReset),
        ConnectionResetCode,
        ConnectionResetMessage,
        502,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>NET0003</c>.</summary>
    public static DiagnosticDescriptor HostUnresolved { get; } = new DiagnosticDescriptor(
        nameof(HostUnresolved),
        HostUnresolvedCode,
        HostUnresolvedMessage,
        502,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>NET0004</c>.</summary>
    public static DiagnosticDescriptor TlsHandshakeFailed { get; } = new DiagnosticDescriptor(
        nameof(TlsHandshakeFailed),
        TlsHandshakeFailedCode,
        TlsHandshakeFailedMessage,
        502,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>NET0005</c>.</summary>
    public static DiagnosticDescriptor ProxyRejected { get; } = new DiagnosticDescriptor(
        nameof(ProxyRejected),
        ProxyRejectedCode,
        ProxyRejectedMessage,
        502,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>STO0001</c>.</summary>
    public static DiagnosticDescriptor StorageUnavailable { get; } = new DiagnosticDescriptor(
        nameof(StorageUnavailable),
        StorageUnavailableCode,
        StorageUnavailableMessage,
        503,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>STO0002</c>.</summary>
    public static DiagnosticDescriptor StorageReadOnly { get; } = new DiagnosticDescriptor(
        nameof(StorageReadOnly),
        StorageReadOnlyCode,
        StorageReadOnlyMessage,
        503,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>STO0003</c>.</summary>
    public static DiagnosticDescriptor StorageCorrupt { get; } = new DiagnosticDescriptor(
        nameof(StorageCorrupt),
        StorageCorruptCode,
        StorageCorruptMessage,
        500,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>STO0004</c>.</summary>
    public static DiagnosticDescriptor TransactionAborted { get; } = new DiagnosticDescriptor(
        nameof(TransactionAborted),
        TransactionAbortedCode,
        TransactionAbortedMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>STO0005</c>.</summary>
    public static DiagnosticDescriptor DeadlockDetected { get; } = new DiagnosticDescriptor(
        nameof(DeadlockDetected),
        DeadlockDetectedCode,
        DeadlockDetectedMessage,
        409,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>STO0006</c>.</summary>
    public static DiagnosticDescriptor MigrationPending { get; } = new DiagnosticDescriptor(
        nameof(MigrationPending),
        MigrationPendingCode,
        MigrationPendingMessage,
        503,
        DiagnosticSeverity.Transient);

    /// <summary>Descriptor for <c>CFG0001</c>.</summary>
    public static DiagnosticDescriptor ConfigurationMissing { get; } = new DiagnosticDescriptor(
        nameof(ConfigurationMissing),
        ConfigurationMissingCode,
        ConfigurationMissingMessage,
        500,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>CFG0002</c>.</summary>
    public static DiagnosticDescriptor ConfigurationInvalid { get; } = new DiagnosticDescriptor(
        nameof(ConfigurationInvalid),
        ConfigurationInvalidCode,
        ConfigurationInvalidMessage,
        500,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>CFG0003</c>.</summary>
    public static DiagnosticDescriptor FeatureDisabled { get; } = new DiagnosticDescriptor(
        nameof(FeatureDisabled),
        FeatureDisabledCode,
        FeatureDisabledMessage,
        403,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>CFG0004</c>.</summary>
    public static DiagnosticDescriptor DependencyMissing { get; } = new DiagnosticDescriptor(
        nameof(DependencyMissing),
        DependencyMissingCode,
        DependencyMissingMessage,
        500,
        DiagnosticSeverity.Permanent);

    /// <summary>Descriptor for <c>INT0001</c>.</summary>
    public static DiagnosticDescriptor InternalError { get; } = new DiagnosticDescriptor(
        nameof(InternalError),
        InternalErrorCode,
        InternalErrorMessage,
        500,
        DiagnosticSeverity.Permanent);

    private static readonly Dictionary<string, DiagnosticDescriptor> ByCode = new()
    {
        [ArgumentNullCode] = ArgumentNull,
        [ArgumentOutOfRangeCode] = ArgumentOutOfRange,
        [ArgumentEmptyCode] = ArgumentEmpty,
        [ArgumentWhitespaceCode] = ArgumentWhitespace,
        [ArgumentNotPositiveCode] = ArgumentNotPositive,
        [ArgumentNotFiniteCode] = ArgumentNotFinite,
        [ArgumentBadFormatCode] = ArgumentBadFormat,
        [ArgumentDuplicateCode] = ArgumentDuplicate,
        [InvalidOperationCode] = InvalidOperation,
        [OperationCancelledCode] = OperationCancelled,
        [OperationTimedOutCode] = OperationTimedOut,
        [OperationSupersededCode] = OperationSuperseded,
        [OperationInProgressCode] = OperationInProgress,
        [OperationNotStartedCode] = OperationNotStarted,
        [NotFoundCode] = NotFound,
        [NotFoundInScopeCode] = NotFoundInScope,
        [GoneCode] = Gone,
        [ConflictCode] = Conflict,
        [PreconditionFailedCode] = PreconditionFailed,
        [PayloadTooLargeCode] = PayloadTooLarge,
        [UnauthenticatedCode] = Unauthenticated,
        [UnauthorizedCode] = Unauthorized,
        [TokenExpiredCode] = TokenExpired,
        [TokenMalformedCode] = TokenMalformed,
        [SignatureInvalidCode] = SignatureInvalid,
        [ScopeInsufficientCode] = ScopeInsufficient,
        [QuotaExceededCode] = QuotaExceeded,
        [RateLimitedCode] = RateLimited,
        [ConcurrencyLimitCode] = ConcurrencyLimit,
        [SerialisationFailedCode] = SerialisationFailed,
        [DeserialisationFailedCode] = DeserialisationFailed,
        [SchemaMismatchCode] = SchemaMismatch,
        [VersionMismatchCode] = VersionMismatch,
        [EncodingUnsupportedCode] = EncodingUnsupported,
        [ConnectionFailedCode] = ConnectionFailed,
        [ConnectionResetCode] = ConnectionReset,
        [HostUnresolvedCode] = HostUnresolved,
        [TlsHandshakeFailedCode] = TlsHandshakeFailed,
        [ProxyRejectedCode] = ProxyRejected,
        [StorageUnavailableCode] = StorageUnavailable,
        [StorageReadOnlyCode] = StorageReadOnly,
        [StorageCorruptCode] = StorageCorrupt,
        [TransactionAbortedCode] = TransactionAborted,
        [DeadlockDetectedCode] = DeadlockDetected,
        [MigrationPendingCode] = MigrationPending,
        [ConfigurationMissingCode] = ConfigurationMissing,
        [ConfigurationInvalidCode] = ConfigurationInvalid,
        [FeatureDisabledCode] = FeatureDisabled,
        [DependencyMissingCode] = DependencyMissing,
        [InternalErrorCode] = InternalError,
    };

    /// <summary>Every descriptor, in declaration order.</summary>
    public static IReadOnlyList<DiagnosticDescriptor> All { get; } = new ReadOnlyCollection<DiagnosticDescriptor>(
        new List<DiagnosticDescriptor>
        {
            ArgumentNull,
            ArgumentOutOfRange,
            ArgumentEmpty,
            ArgumentWhitespace,
            ArgumentNotPositive,
            ArgumentNotFinite,
            ArgumentBadFormat,
            ArgumentDuplicate,
            InvalidOperation,
            OperationCancelled,
            OperationTimedOut,
            OperationSuperseded,
            OperationInProgress,
            OperationNotStarted,
            NotFound,
            NotFoundInScope,
            Gone,
            Conflict,
            PreconditionFailed,
            PayloadTooLarge,
            Unauthenticated,
            Unauthorized,
            TokenExpired,
            TokenMalformed,
            SignatureInvalid,
            ScopeInsufficient,
            QuotaExceeded,
            RateLimited,
            ConcurrencyLimit,
            SerialisationFailed,
            DeserialisationFailed,
            SchemaMismatch,
            VersionMismatch,
            EncodingUnsupported,
            ConnectionFailed,
            ConnectionReset,
            HostUnresolved,
            TlsHandshakeFailed,
            ProxyRejected,
            StorageUnavailable,
            StorageReadOnly,
            StorageCorrupt,
            TransactionAborted,
            DeadlockDetected,
            MigrationPending,
            ConfigurationMissing,
            ConfigurationInvalid,
            FeatureDisabled,
            DependencyMissing,
            InternalError,
        });

    /// <summary>Looks a descriptor up by its wire code.</summary>
    public static bool TryGet(string code, out DiagnosticDescriptor? descriptor) =>
        ByCode.TryGetValue(code, out descriptor);

    /// <summary>Maps a wire code to its HTTP status without a dictionary lookup.</summary>
    public static int StatusOf(string code) => code switch
    {
        ArgumentNullCode => 400,
        ArgumentOutOfRangeCode => 400,
        ArgumentEmptyCode => 400,
        ArgumentWhitespaceCode => 400,
        ArgumentNotPositiveCode => 400,
        ArgumentNotFiniteCode => 400,
        ArgumentBadFormatCode => 400,
        ArgumentDuplicateCode => 409,
        InvalidOperationCode => 409,
        OperationCancelledCode => 499,
        OperationTimedOutCode => 504,
        OperationSupersededCode => 409,
        OperationInProgressCode => 409,
        OperationNotStartedCode => 409,
        NotFoundCode => 404,
        NotFoundInScopeCode => 404,
        GoneCode => 410,
        ConflictCode => 409,
        PreconditionFailedCode => 412,
        PayloadTooLargeCode => 413,
        UnauthenticatedCode => 401,
        UnauthorizedCode => 403,
        TokenExpiredCode => 401,
        TokenMalformedCode => 401,
        SignatureInvalidCode => 401,
        ScopeInsufficientCode => 403,
        QuotaExceededCode => 429,
        RateLimitedCode => 429,
        ConcurrencyLimitCode => 429,
        SerialisationFailedCode => 500,
        DeserialisationFailedCode => 400,
        SchemaMismatchCode => 400,
        VersionMismatchCode => 400,
        EncodingUnsupportedCode => 415,
        ConnectionFailedCode => 502,
        ConnectionResetCode => 502,
        HostUnresolvedCode => 502,
        TlsHandshakeFailedCode => 502,
        ProxyRejectedCode => 502,
        StorageUnavailableCode => 503,
        StorageReadOnlyCode => 503,
        StorageCorruptCode => 500,
        TransactionAbortedCode => 409,
        DeadlockDetectedCode => 409,
        MigrationPendingCode => 503,
        ConfigurationMissingCode => 500,
        ConfigurationInvalidCode => 500,
        FeatureDisabledCode => 403,
        DependencyMissingCode => 500,
        InternalErrorCode => 500,
        _ => 500,
    };

    /// <summary>Maps a wire code to a retry hint, as a switch STATEMENT.</summary>
    public static TimeSpan RetryAfter(string code)
    {
        switch (code)
        {
            case OperationCancelledCode:
                return TimeSpan.FromSeconds(0);

            case OperationTimedOutCode:
                return TimeSpan.FromSeconds(15);

            case QuotaExceededCode:
                return TimeSpan.FromSeconds(30);

            case RateLimitedCode:
                return TimeSpan.FromSeconds(30);

            case ConcurrencyLimitCode:
                return TimeSpan.FromSeconds(30);

            case ConnectionFailedCode:
                return TimeSpan.FromSeconds(5);

            case ConnectionResetCode:
                return TimeSpan.FromSeconds(5);

            case HostUnresolvedCode:
                return TimeSpan.FromSeconds(5);

            case TlsHandshakeFailedCode:
                return TimeSpan.FromSeconds(5);

            case ProxyRejectedCode:
                return TimeSpan.FromSeconds(5);

            case StorageUnavailableCode:
                return TimeSpan.FromSeconds(10);

            case StorageReadOnlyCode:
                return TimeSpan.FromSeconds(10);

            case MigrationPendingCode:
                return TimeSpan.FromSeconds(10);

            default:
                return TimeSpan.Zero;
        }
    }

    /// <summary>Throw helpers, one per catalogued diagnostic.</summary>
    /// <summary>Throws for <c>ARG0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentNull(string? detail = null) =>
        throw new CataloguedException(ArgumentNull, detail);

    /// <summary>Throws for <c>ARG0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentOutOfRange(string? detail = null) =>
        throw new CataloguedException(ArgumentOutOfRange, detail);

    /// <summary>Throws for <c>ARG0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentEmpty(string? detail = null) =>
        throw new CataloguedException(ArgumentEmpty, detail);

    /// <summary>Throws for <c>ARG0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentWhitespace(string? detail = null) =>
        throw new CataloguedException(ArgumentWhitespace, detail);

    /// <summary>Throws for <c>ARG0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentNotPositive(string? detail = null) =>
        throw new CataloguedException(ArgumentNotPositive, detail);

    /// <summary>Throws for <c>ARG0006</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentNotFinite(string? detail = null) =>
        throw new CataloguedException(ArgumentNotFinite, detail);

    /// <summary>Throws for <c>ARG0007</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentBadFormat(string? detail = null) =>
        throw new CataloguedException(ArgumentBadFormat, detail);

    /// <summary>Throws for <c>ARG0008</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowArgumentDuplicate(string? detail = null) =>
        throw new CataloguedException(ArgumentDuplicate, detail);

    /// <summary>Throws for <c>OPS0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowInvalidOperation(string? detail = null) =>
        throw new CataloguedException(InvalidOperation, detail);

    /// <summary>Throws for <c>OPS0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowOperationCancelled(string? detail = null) =>
        throw new CataloguedException(OperationCancelled, detail);

    /// <summary>Throws for <c>OPS0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowOperationTimedOut(string? detail = null) =>
        throw new CataloguedException(OperationTimedOut, detail);

    /// <summary>Throws for <c>OPS0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowOperationSuperseded(string? detail = null) =>
        throw new CataloguedException(OperationSuperseded, detail);

    /// <summary>Throws for <c>OPS0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowOperationInProgress(string? detail = null) =>
        throw new CataloguedException(OperationInProgress, detail);

    /// <summary>Throws for <c>OPS0006</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowOperationNotStarted(string? detail = null) =>
        throw new CataloguedException(OperationNotStarted, detail);

    /// <summary>Throws for <c>RES0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowNotFound(string? detail = null) =>
        throw new CataloguedException(NotFound, detail);

    /// <summary>Throws for <c>RES0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowNotFoundInScope(string? detail = null) =>
        throw new CataloguedException(NotFoundInScope, detail);

    /// <summary>Throws for <c>RES0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowGone(string? detail = null) =>
        throw new CataloguedException(Gone, detail);

    /// <summary>Throws for <c>RES0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConflict(string? detail = null) =>
        throw new CataloguedException(Conflict, detail);

    /// <summary>Throws for <c>RES0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowPreconditionFailed(string? detail = null) =>
        throw new CataloguedException(PreconditionFailed, detail);

    /// <summary>Throws for <c>RES0006</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowPayloadTooLarge(string? detail = null) =>
        throw new CataloguedException(PayloadTooLarge, detail);

    /// <summary>Throws for <c>SEC0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowUnauthenticated(string? detail = null) =>
        throw new CataloguedException(Unauthenticated, detail);

    /// <summary>Throws for <c>SEC0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowUnauthorized(string? detail = null) =>
        throw new CataloguedException(Unauthorized, detail);

    /// <summary>Throws for <c>SEC0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowTokenExpired(string? detail = null) =>
        throw new CataloguedException(TokenExpired, detail);

    /// <summary>Throws for <c>SEC0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowTokenMalformed(string? detail = null) =>
        throw new CataloguedException(TokenMalformed, detail);

    /// <summary>Throws for <c>SEC0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowSignatureInvalid(string? detail = null) =>
        throw new CataloguedException(SignatureInvalid, detail);

    /// <summary>Throws for <c>SEC0006</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowScopeInsufficient(string? detail = null) =>
        throw new CataloguedException(ScopeInsufficient, detail);

    /// <summary>Throws for <c>LIM0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowQuotaExceeded(string? detail = null) =>
        throw new CataloguedException(QuotaExceeded, detail);

    /// <summary>Throws for <c>LIM0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowRateLimited(string? detail = null) =>
        throw new CataloguedException(RateLimited, detail);

    /// <summary>Throws for <c>LIM0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConcurrencyLimit(string? detail = null) =>
        throw new CataloguedException(ConcurrencyLimit, detail);

    /// <summary>Throws for <c>SER0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowSerialisationFailed(string? detail = null) =>
        throw new CataloguedException(SerialisationFailed, detail);

    /// <summary>Throws for <c>SER0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowDeserialisationFailed(string? detail = null) =>
        throw new CataloguedException(DeserialisationFailed, detail);

    /// <summary>Throws for <c>SER0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowSchemaMismatch(string? detail = null) =>
        throw new CataloguedException(SchemaMismatch, detail);

    /// <summary>Throws for <c>SER0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowVersionMismatch(string? detail = null) =>
        throw new CataloguedException(VersionMismatch, detail);

    /// <summary>Throws for <c>SER0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowEncodingUnsupported(string? detail = null) =>
        throw new CataloguedException(EncodingUnsupported, detail);

    /// <summary>Throws for <c>NET0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConnectionFailed(string? detail = null) =>
        throw new CataloguedException(ConnectionFailed, detail);

    /// <summary>Throws for <c>NET0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConnectionReset(string? detail = null) =>
        throw new CataloguedException(ConnectionReset, detail);

    /// <summary>Throws for <c>NET0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowHostUnresolved(string? detail = null) =>
        throw new CataloguedException(HostUnresolved, detail);

    /// <summary>Throws for <c>NET0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowTlsHandshakeFailed(string? detail = null) =>
        throw new CataloguedException(TlsHandshakeFailed, detail);

    /// <summary>Throws for <c>NET0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowProxyRejected(string? detail = null) =>
        throw new CataloguedException(ProxyRejected, detail);

    /// <summary>Throws for <c>STO0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowStorageUnavailable(string? detail = null) =>
        throw new CataloguedException(StorageUnavailable, detail);

    /// <summary>Throws for <c>STO0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowStorageReadOnly(string? detail = null) =>
        throw new CataloguedException(StorageReadOnly, detail);

    /// <summary>Throws for <c>STO0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowStorageCorrupt(string? detail = null) =>
        throw new CataloguedException(StorageCorrupt, detail);

    /// <summary>Throws for <c>STO0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowTransactionAborted(string? detail = null) =>
        throw new CataloguedException(TransactionAborted, detail);

    /// <summary>Throws for <c>STO0005</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowDeadlockDetected(string? detail = null) =>
        throw new CataloguedException(DeadlockDetected, detail);

    /// <summary>Throws for <c>STO0006</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowMigrationPending(string? detail = null) =>
        throw new CataloguedException(MigrationPending, detail);

    /// <summary>Throws for <c>CFG0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConfigurationMissing(string? detail = null) =>
        throw new CataloguedException(ConfigurationMissing, detail);

    /// <summary>Throws for <c>CFG0002</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowConfigurationInvalid(string? detail = null) =>
        throw new CataloguedException(ConfigurationInvalid, detail);

    /// <summary>Throws for <c>CFG0003</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowFeatureDisabled(string? detail = null) =>
        throw new CataloguedException(FeatureDisabled, detail);

    /// <summary>Throws for <c>CFG0004</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowDependencyMissing(string? detail = null) =>
        throw new CataloguedException(DependencyMissing, detail);

    /// <summary>Throws for <c>INT0001</c>.</summary>
    /// <param name="detail">Additional context appended to the message.</param>
    /// <exception cref="CataloguedException">Always.</exception>
    public static void ThrowInternalError(string? detail = null) =>
        throw new CataloguedException(InternalError, detail);

    /// <summary>Formats a descriptor for a log line.</summary>
    public static string Format(DiagnosticDescriptor descriptor, string? detail) =>
        detail is null
            ? $"[{descriptor.Code}] {descriptor.Message}"
            : $"[{descriptor.Code}] {descriptor.Message} ({detail})";
}

/// <summary>An exception carrying a catalogued descriptor.</summary>
public sealed class CataloguedException : Exception
{
    /// <summary>Creates an exception for the supplied descriptor.</summary>
    public CataloguedException(DiagnosticDescriptor descriptor, string? detail = null)
        : base(DiagnosticCatalogue.Format(descriptor, detail))
    {
        Descriptor = descriptor;
        Detail = detail;
    }

    /// <summary>The descriptor this exception was raised for.</summary>
    public DiagnosticDescriptor Descriptor { get; }

    /// <summary>Additional context, if any.</summary>
    public string? Detail { get; }

    /// <summary>Whether a caller may reasonably retry.</summary>
    public bool IsRetryable => Descriptor.IsRetryable;
}

// ---------------------------------------------------------------------------
// MARKER: PAST-THE-BOUNDARY DECLARATIONS BEGIN HERE.
//
// Everything below this line sits well beyond the 32,767th character. A parser
// reading the file directly emits NOTHING for this file at all; one reading it
// through the callback emits all of it. There is no third outcome, which is
// what makes these three declarations a usable measurement rather than a
// suggestion.
// ---------------------------------------------------------------------------

/// <summary>Declared past the boundary. Its absence is the measurement.</summary>
public sealed class LateDeclaration
{
    private readonly Dictionary<string, int> counts = new();

    /// <summary>Declared past the boundary.</summary>
    public int Count => counts.Count;

    /// <summary>Declared past the boundary.</summary>
    public void Record(string code)
    {
        counts[code] = counts.TryGetValue(code, out int found) ? found + 1 : 1;
    }

    /// <summary>Declared past the boundary; calls a member declared before it.</summary>
    public int StatusFor(string code) => DiagnosticCatalogue.StatusOf(code);

    /// <summary>Declared past the boundary; a generic method with a constraint.</summary>
    public T? FirstOrDefault<T>(IEnumerable<T> source) where T : class
    {
        foreach (T item in source)
        {
            return item;
        }

        return null;
    }
}

/// <summary>Declared past the boundary.</summary>
public interface ILateInterface
{
    /// <summary>Declared past the boundary.</summary>
    int Count { get; }

    /// <summary>Declared past the boundary, with a default implementation.</summary>
    bool IsEmpty => Count == 0;
}

/// <summary>Declared past the boundary; a positional record.</summary>
public sealed record LateRecord(string Code, int Status) : ILateInterface
{
    /// <inheritdoc />
    public int Count => 1;

    /// <summary>Declared past the boundary.</summary>
    public DiagnosticDescriptor? Descriptor =>
        DiagnosticCatalogue.TryGet(Code, out DiagnosticDescriptor? found) ? found : null;
}
