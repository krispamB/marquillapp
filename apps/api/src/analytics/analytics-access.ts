import { ApiError } from '../common/HelperFn/apiFetch.helper';
import { LinkedinAccountType } from '../database/schemas/connected-account.schema';
import type { AnalyticsAccess } from './interfaces';

/**
 * How a LinkedIn call failed:
 * - `unauthorized`: 401, the token is no longer accepted.
 * - `forbidden`: 403, a missing scope (member) or lost admin role (page).
 * - `transient`: 429, 5xx, timeout or network; may clear up on its own.
 * - `failed`: any other 4xx.
 */
export type FailureKind = 'unauthorized' | 'forbidden' | 'transient' | 'failed';

export function classifyLinkedinFailure(error: unknown): FailureKind {
  if (error instanceof ApiError) {
    if (error.statusCode === 401) return 'unauthorized';
    if (error.statusCode === 403) return 'forbidden';
    if (error.statusCode === 429 || error.statusCode >= 500) return 'transient';
    return 'failed';
  }
  return 'transient';
}

export type Section<T> =
  | { ok: true; value: T }
  | { ok: false; failure: FailureKind; error: unknown };

export type Settled<T extends Record<string, Promise<unknown>>> = {
  [K in keyof T]: Section<Awaited<T[K]>>;
};

/**
 * Awaits every task, never rejecting: one LinkedIn section failing must not
 * fail the others. The tasks are already running when passed in.
 */
export async function settleSections<
  T extends Record<string, Promise<unknown>>,
>(tasks: T): Promise<Settled<T>> {
  const keys = Object.keys(tasks) as Array<keyof T>;
  const results = await Promise.allSettled(keys.map((key) => tasks[key]));
  const settled = {} as Settled<T>;
  keys.forEach((key, index) => {
    const result = results[index];
    settled[key] = (
      result.status === 'fulfilled'
        ? { ok: true, value: result.value }
        : {
            ok: false,
            failure: classifyLinkedinFailure(result.reason),
            error: result.reason,
          }
    ) as Section<Awaited<T[typeof key]>>;
  });
  return settled;
}

export interface AccessDecision {
  access: AnalyticsAccess;
  /** Some section failed with a transient error. */
  transientFailure: boolean;
}

/**
 * The response's `access` from every section of one request:
 * - any 401 → `reconnect_required` for a page, `missing_scope` for a member
 *   (every call shares the one token);
 * - at least one success → `ok`, the failures listed as unavailable;
 * - everything failed with a 403 among them → `missing_scope` for a member,
 *   `not_admin` for a page;
 * - everything failed otherwise → `unavailable`.
 * No sections at all (nothing to ask LinkedIn) is `ok`.
 */
export function resolveAccess(
  sections: Array<Section<unknown>>,
  accountType: LinkedinAccountType,
): AccessDecision {
  const failures = sections.flatMap((section) =>
    section.ok ? [] : [section.failure],
  );
  const transientFailure = failures.includes('transient');
  if (failures.includes('unauthorized')) {
    // A member is read with the analytics app's token, which is renewed by
    // granting analytics again, not by reconnecting the account.
    return {
      access:
        accountType === LinkedinAccountType.ORGANIZATION
          ? 'reconnect_required'
          : 'missing_scope',
      transientFailure,
    };
  }
  if (sections.length === 0 || failures.length < sections.length) {
    return { access: 'ok', transientFailure };
  }
  if (failures.includes('forbidden')) {
    return {
      access:
        accountType === LinkedinAccountType.ORGANIZATION
          ? 'not_admin'
          : 'missing_scope',
      transientFailure,
    };
  }
  return { access: 'unavailable', transientFailure };
}
