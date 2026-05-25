/**
 * Application errors that carry an HTTP status. The centralized error handler
 * (see app.ts) translates these into a uniform JSON response and a log line
 * tagged with the request id.
 *
 * Throw / next(...) one of the subclasses from anywhere in the request
 * pipeline rather than calling res.status(...).json(...) directly.
 */
export class HttpError extends Error {
    public readonly status: number;
    public readonly publicMessage: string;
    public readonly details?: unknown;
    public readonly headers?: Record<string, string>;

    constructor(
        status: number,
        publicMessage: string,
        options?: { details?: unknown; headers?: Record<string, string>; cause?: unknown }
    ) {
        super(publicMessage);
        this.name = this.constructor.name;
        this.status = status;
        this.publicMessage = publicMessage;
        this.details = options?.details;
        this.headers = options?.headers;
        if (options?.cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = options.cause;
        }
    }
}

export class BadRequestError extends HttpError {
    constructor(message = "Bad Request", details?: unknown) {
        super(400, message, { details });
    }
}

export class UnauthorizedError extends HttpError {
    constructor(message = "Unauthorized", details?: unknown) {
        super(401, message, { details });
    }
}

export class ForbiddenError extends HttpError {
    constructor(message = "Forbidden", details?: unknown) {
        super(403, message, { details });
    }
}

export class NotFoundError extends HttpError {
    constructor(message = "Not Found", details?: unknown) {
        super(404, message, { details });
    }
}

export class ConflictError extends HttpError {
    constructor(message = "Conflict", details?: unknown) {
        super(409, message, { details });
    }
}

export class PayloadTooLargeError extends HttpError {
    constructor(message = "Payload Too Large", details?: unknown) {
        super(413, message, { details });
    }
}

export class TooManyRequestsError extends HttpError {
    constructor(message = "Too Many Requests", retryAfterSec?: number, details?: unknown) {
        super(429, message, {
            details,
            headers:
                retryAfterSec !== undefined
                    ? { "Retry-After": String(Math.max(retryAfterSec, 1)) }
                    : undefined,
        });
    }
}

export class InternalServerError extends HttpError {
    constructor(message = "Internal Server Error", details?: unknown) {
        super(500, message, { details });
    }
}
