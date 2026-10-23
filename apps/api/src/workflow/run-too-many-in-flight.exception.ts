import { HttpException, HttpStatus } from '@nestjs/common';

export const RUN_TOO_MANY_IN_FLIGHT_CODE = 'run.too_many_in_flight';

/**
 * A launch past `MAX_INFLIGHT_RUNS_PER_USER`: HTTP 429 with a stable `code`
 * the client can branch on and a `message` it can show as written.
 */
export class RunTooManyInFlightException extends HttpException {
  constructor(limit: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: RUN_TOO_MANY_IN_FLIGHT_CODE,
        limit,
        message: `You can have ${limit} ${limit === 1 ? 'run' : 'runs'} in progress at once. Wait for one to finish, then try again.`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
