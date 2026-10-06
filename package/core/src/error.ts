

export class AppError extends Error {
    public errorCode: string;
    public statusCode: number;
    public details?: any;
    public message: string;

    constructor(errorCode: string, statusCode: number, message: string, details?: any) {
        super(message);
        this.errorCode = errorCode;
        this.statusCode = statusCode;
        this.message = message;
        this.details = details;
    }
}

export class NotFoundError extends AppError {
    constructor(message: string, details?: any) {
        super('NOT_FOUND', 404, message, details);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: any) {
        super('VALIDATION_ERROR', 400, message, details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string, details?: any) {
        super('UNAUTHORIZED', 401, message, details);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string, details?: any) {
        super('FORBIDDEN', 403, message, details);
    }
}

export class InternalServerError extends AppError {
    constructor(message: string, details?: any) {
        super('INTERNAL_SERVER_ERROR', 500, message, details);
    }
}

export class BadRequestError extends AppError {
    constructor(message: string, details?: any) {
        super('BAD_REQUEST', 400, message, details);
    }
}

export class UpstreamError extends AppError {
    constructor(message: string, details?: any) {
        super('UPSTREAM_ERROR', 502, message, details);
    }
}

export class UpstreamTimeoutError extends AppError {
    constructor(message: string, details?: any) {
        super('UPSTREAM_TIMEOUT', 504, message, details);
    }
}

export class TooManyRequestsError extends AppError {
    constructor(message: string, details?: any) {
        super('TOO_MANY_REQUESTS', 429, message, details);
    }
}