import { ApiError } from '../common/HelperFn/apiFetch.helper';
import { LinkedinAccountType } from '../database/schemas/connected-account.schema';
import {
  classifyLinkedinFailure,
  resolveAccess,
  settleSections,
  type Section,
} from './analytics-access';

const ok: Section<unknown> = { ok: true, value: 1 };
const fail = (failure: 'unauthorized' | 'forbidden' | 'transient' | 'failed') =>
  ({ ok: false, failure, error: new Error(failure) }) as Section<unknown>;

describe('analytics-access', () => {
  describe('classifyLinkedinFailure', () => {
    it.each([
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [429, 'transient'],
      [500, 'transient'],
      [503, 'transient'],
      [400, 'failed'],
      [404, 'failed'],
    ])('should classify HTTP %i as %s', (status, kind) => {
      expect(classifyLinkedinFailure(new ApiError(status, '', {}))).toBe(kind);
    });

    it('should treat network errors and timeouts as transient', () => {
      expect(classifyLinkedinFailure(new TypeError('fetch failed'))).toBe(
        'transient',
      );
      const timeout = new DOMException('timed out', 'TimeoutError');
      expect(classifyLinkedinFailure(timeout)).toBe('transient');
    });
  });

  describe('settleSections', () => {
    it('should keep successes when another section rejects', async () => {
      const settled = await settleSections({
        a: Promise.resolve(5),
        b: Promise.reject(new ApiError(403, 'Forbidden', {})),
      });
      expect(settled.a).toEqual({ ok: true, value: 5 });
      expect(settled.b).toMatchObject({ ok: false, failure: 'forbidden' });
    });
  });

  describe('resolveAccess', () => {
    const PERSON = LinkedinAccountType.PERSON;
    const ORGANIZATION = LinkedinAccountType.ORGANIZATION;

    it('should be ok when every section succeeded', () => {
      expect(resolveAccess([ok, ok], PERSON)).toEqual({
        access: 'ok',
        transientFailure: false,
      });
    });

    it('should be ok with a transient flag when some sections failed', () => {
      expect(resolveAccess([ok, fail('transient')], PERSON)).toEqual({
        access: 'ok',
        transientFailure: true,
      });
    });

    it('should be ok when only one scope of several is missing', () => {
      expect(resolveAccess([ok, fail('forbidden')], PERSON).access).toBe('ok');
    });

    it('should be missing_scope for a member when every section was forbidden', () => {
      expect(
        resolveAccess([fail('forbidden'), fail('forbidden')], PERSON).access,
      ).toBe('missing_scope');
    });

    it('should be not_admin for a page when every section was forbidden', () => {
      expect(
        resolveAccess([fail('forbidden'), fail('transient')], ORGANIZATION)
          .access,
      ).toBe('not_admin');
    });

    it('should be reconnect_required when any section of a page was unauthorized', () => {
      expect(
        resolveAccess([ok, fail('unauthorized')], ORGANIZATION).access,
      ).toBe('reconnect_required');
    });

    it('should be missing_scope when any section of a member was unauthorized', () => {
      expect(resolveAccess([ok, fail('unauthorized')], PERSON).access).toBe(
        'missing_scope',
      );
    });

    it('should be unavailable when every section failed without a 401 or 403', () => {
      expect(
        resolveAccess([fail('transient'), fail('failed')], ORGANIZATION),
      ).toEqual({ access: 'unavailable', transientFailure: true });
    });

    it('should be ok when there was nothing to ask', () => {
      expect(resolveAccess([], PERSON).access).toBe('ok');
    });
  });
});
