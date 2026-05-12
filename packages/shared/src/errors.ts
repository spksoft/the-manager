export class TheManagerError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TheManagerError";
    this.code = code;
  }
}

export class NotImplementedError extends TheManagerError {
  constructor(what: string) {
    super("NOT_IMPLEMENTED", `${what} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

export class NotFoundError extends TheManagerError {
  constructor(what: string, id: string) {
    super("NOT_FOUND", `${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends TheManagerError {
  constructor(message: string, options?: ErrorOptions) {
    super("VALIDATION", message, options);
    this.name = "ValidationError";
  }
}
