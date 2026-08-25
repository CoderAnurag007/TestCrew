export class HttpError extends Error {
  readonly statusCode: number;
  readonly error: string;

  constructor(statusCode: number, message: string, error?: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error ?? statusName(statusCode);
  }
}

function statusName(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 429:
      return 'Too Many Requests';
    default:
      return 'Error';
  }
}
