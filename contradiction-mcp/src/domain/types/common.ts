export type EntityId = string;

export type ISODateString = string;

export interface Timestamps {
  createdAt: Date;
  updatedAt?: Date;
}

export type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export type Metadata = Record<string, unknown>;

export class ContradictionError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, code = 'INTERNAL_ERROR', isOperational = true, details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  public toSafeObject(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends ContradictionError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', true, details);
  }
}

export class NotFoundError extends ContradictionError {
  constructor(entityName: string, id: string) {
    super(`${entityName} with id '${id}' not found`, 'NOT_FOUND', true, { entityName, id });
  }
}

export class DatabaseError extends ContradictionError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', true, details);
  }
}

export class ConfigurationError extends ContradictionError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', false);
  }
}

export class AuthenticationError extends ContradictionError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHENTICATION_ERROR', true, details);
  }
}

export class AuthorizationError extends ContradictionError {
  constructor(message: string, details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', true, details);
  }
}

export class ConnectorError extends ContradictionError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONNECTOR_ERROR', true, details);
  }
}

export function toSafeError(error: unknown): { code: string; message: string } {
  if (error instanceof ContradictionError && error.isOperational) {
    return {
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: String(error),
  };
}
