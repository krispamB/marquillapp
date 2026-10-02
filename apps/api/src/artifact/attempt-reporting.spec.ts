jest.mock(
  'src/database/schemas',
  () => ({
    VersionStatus: {
      GENERATING: 'GENERATING',
      READY: 'READY',
      FAILED: 'FAILED',
    },
  }),
  { virtual: true },
);

import { VersionStatus } from 'src/database/schemas';
import { FailureCode } from '../workflow/workflow.constants';
import {
  artifactStatusFilter,
  deriveArtifactStatus,
  latestAttemptOf,
  newestVersion,
} from './attempt-reporting';

describe('attempt reporting', () => {
  describe('newestVersion', () => {
    it('should pick the highest version number when versions are out of order', () => {
      expect(
        newestVersion([
          { version: 2, status: VersionStatus.FAILED },
          { version: 3, status: VersionStatus.READY },
          { version: 1, status: VersionStatus.READY },
        ]),
      ).toEqual({ version: 3, status: VersionStatus.READY });
    });

    it('should return undefined when there are no versions', () => {
      expect(newestVersion([])).toBeUndefined();
    });
  });

  describe('latestAttemptOf', () => {
    it('should omit the Attempt when the newest version is the Current Version', () => {
      expect(
        latestAttemptOf(2, { version: 2, status: VersionStatus.READY }),
      ).toBeUndefined();
    });

    it('should report a GENERATING Attempt without failure fields when a refine is in flight', () => {
      expect(
        latestAttemptOf(1, {
          version: 2,
          status: VersionStatus.GENERATING,
        }),
      ).toEqual({ version: 2, status: VersionStatus.GENERATING });
    });

    it('should report a FAILED Attempt with its failure when a refine failed', () => {
      expect(
        latestAttemptOf(1, {
          version: 2,
          status: VersionStatus.FAILED,
          failureCode: FailureCode.DOCUMENT_TRUNCATED,
          failureReason: 'Out of tokens',
        }),
      ).toEqual({
        version: 2,
        status: VersionStatus.FAILED,
        failureCode: FailureCode.DOCUMENT_TRUNCATED,
        failureReason: 'Out of tokens',
      });
    });

    it('should report the first version as the Attempt when there is no Current Version', () => {
      expect(
        latestAttemptOf(undefined, {
          version: 1,
          status: VersionStatus.FAILED,
          failureCode: FailureCode.INTERNAL,
          failureReason: 'boom',
        }),
      ).toMatchObject({ version: 1, status: VersionStatus.FAILED });
    });

    it('should never report a READY version as an Attempt when data is inconsistent', () => {
      expect(
        latestAttemptOf(1, { version: 2, status: VersionStatus.READY }),
      ).toBeUndefined();
    });
  });

  describe('deriveArtifactStatus', () => {
    it.each([
      [true, 1, VersionStatus.GENERATING],
      [true, undefined, VersionStatus.GENERATING],
      [false, 1, VersionStatus.READY],
      [false, undefined, VersionStatus.FAILED],
      [false, null, VersionStatus.FAILED],
    ])(
      'should derive the status when in flight is %s and currentVersion is %s',
      (inFlight, currentVersion, expected) => {
        expect(deriveArtifactStatus(inFlight, currentVersion)).toBe(expected);
      },
    );
  });

  describe('artifactStatusFilter', () => {
    // A minimal evaluator for the operators the filter uses, so the filter is
    // checked against the same cases as deriveArtifactStatus.
    const matches = (
      filter: Record<string, unknown>,
      doc: { currentVersion?: number | null; statuses: string[] },
    ): boolean =>
      Object.entries(filter).every(([field, condition]) => {
        if (field === 'versions.status') {
          if (typeof condition === 'string') {
            return doc.statuses.includes(condition);
          }
          const { $ne } = condition as { $ne: string };
          return !doc.statuses.includes($ne);
        }
        if (field === 'currentVersion') {
          const value = doc.currentVersion ?? null;
          if (condition === null) return value === null;
          return value !== (condition as { $ne: null }).$ne;
        }
        throw new Error(`Unexpected field ${field}`);
      });

    const cases = [
      { currentVersion: 1, statuses: ['READY', 'GENERATING'] },
      { statuses: ['GENERATING'] },
      { currentVersion: 1, statuses: ['READY', 'FAILED'] },
      { currentVersion: 2, statuses: ['READY', 'READY'] },
      { statuses: ['FAILED'] },
      { currentVersion: null, statuses: ['FAILED'] },
    ];

    it.each(cases)(
      'should match exactly the derived status when the artifact is %j',
      (doc) => {
        const derived = deriveArtifactStatus(
          doc.statuses.includes(VersionStatus.GENERATING),
          doc.currentVersion,
        );
        for (const status of Object.values(VersionStatus)) {
          expect(matches(artifactStatusFilter(status), doc)).toBe(
            status === derived,
          );
        }
      },
    );
  });
});
