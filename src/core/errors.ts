/**
 * Domain errors. They carry a machine code and an HTTP status, but know NOTHING about HTTP -
 * the http layer only reads `status`. That lets the core be tested without a server, while a
 * validation error never leaves the building as a 500.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export const badRequest = (code: string, message: string) => new AppError(code, message, 400);
export const unauthorized = (code: string, message: string) => new AppError(code, message, 401);
export const forbidden = (code: string, message: string) => new AppError(code, message, 403);
export const notFound = (code: string, message: string) => new AppError(code, message, 404);
export const conflict = (code: string, message: string) => new AppError(code, message, 409);
export const tooLarge = (code: string, message: string) => new AppError(code, message, 413);
export const tooMany = (code: string, message: string) => new AppError(code, message, 429);
