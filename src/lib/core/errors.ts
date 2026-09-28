export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'invalid_request'
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
export class AcknowledgementRequired extends DomainError {
  constructor(message: string) {
    super(message, 409, 'acknowledgement_required');
    this.name = 'AcknowledgementRequired';
  }
}
