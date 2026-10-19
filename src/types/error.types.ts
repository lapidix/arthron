export type ErrorMessageResolver = (
  data: unknown,
  response: Response,
) => string | undefined;
