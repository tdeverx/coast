export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'request_failed'
  ) {
    super(message);
    this.name = 'AppError';
  }
}
