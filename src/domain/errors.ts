type ErrorDetails = {
  readonly message: string;
  readonly field?: string | undefined;
  readonly operation?: string | undefined;
};

export class ValidationError extends Error {
  readonly _tag = "ValidationError";
  readonly field: string | undefined;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = "ValidationError";
    this.field = details.field;
  }
}

export class RepositoryError extends Error {
  readonly _tag = "RepositoryError";
  readonly operation: string | undefined;

  constructor(details: ErrorDetails) {
    super(details.message);
    this.name = "RepositoryError";
    this.operation = details.operation;
  }
}

type AppError = ValidationError | RepositoryError;

export const statusCodeForError = (error: AppError): 400 | 401 | 403 | 500 => {
  if (error instanceof ValidationError) {
    return 400;
  }

  return 500;
};

export const errorBody = (error: AppError) => ({
  error: {
    code: error.name,
    message: error.message,
  },
});
