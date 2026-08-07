/**
 * Bledy domenowe. Nosza kod maszynowy i status HTTP, ale NIE wiedza nic o HTTP -
 * warstwa http tylko odczytuje `status`. Dzieki temu rdzen da sie testowac bez serwera,
 * a jednoczesnie blad walidacji nigdy nie wychodzi na zewnatrz jako 500.
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
