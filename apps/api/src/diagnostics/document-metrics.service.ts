import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { WorkflowRun } from 'src/database/schemas';
import {
  computeDocumentMetrics,
  DocumentMetrics,
  DocumentRunRow,
} from './document-metrics';

/** Which runs to measure. Both bounds are optional and combine. */
export interface DocumentMetricsQuery {
  /** Only runs created at or after this instant. */
  since?: Date;
  /** Only these runs, by id: an eval script measures the runs it started. */
  runIds?: string[];
}

/**
 * Document-generation health metrics (spec §11.5), computed on read from the
 * `documentDiagnostics` each DOCUMENT run keeps. The admin route serves it,
 * and `bun run eval:documents` calls it directly.
 */
@Injectable()
export class DocumentMetricsService {
  constructor(
    @InjectModel(WorkflowRun.name)
    private readonly workflowRunModel: Model<WorkflowRun>,
  ) {}

  async aggregate(query: DocumentMetricsQuery = {}): Promise<DocumentMetrics> {
    return computeDocumentMetrics(
      await this.listRuns(query),
      query.since ?? null,
    );
  }

  /**
   * The matched runs, one row each, for callers that gate on single runs
   * (the slowest, the costliest at a page count) rather than on aggregates.
   */
  async listRuns({ since, runIds }: DocumentMetricsQuery = {}): Promise<
    DocumentRunRow[]
  > {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          // Only DOCUMENT runs have diagnostics, and a RETRYING run is still
          // in flight: counting it would read as a failure.
          'documentDiagnostics.outcome': { $in: ['READY', 'FAILED'] },
          ...(since ? { createdAt: { $gte: since } } : {}),
          ...(runIds
            ? { _id: { $in: runIds.map((id) => new Types.ObjectId(id)) } }
            : {}),
        },
      },
      {
        // One small row per run: the diagnostics' codes and counts, never
        // the violation details or any text.
        $project: {
          _id: 0,
          runId: { $toString: '$_id' },
          designSystemId: '$documentDiagnostics.pin.id',
          outcome: '$documentDiagnostics.outcome',
          failureCode: '$documentDiagnostics.failureCode',
          jobAttemptFailureCodes: {
            $map: {
              input: '$documentDiagnostics.jobAttemptFailures',
              as: 'failure',
              in: '$$failure.failureCode',
            },
          },
          candidates: '$documentDiagnostics.candidates',
          repairRounds: '$documentDiagnostics.repairRounds',
          repairs: '$documentDiagnostics.repairs',
          wallTimeMs: '$documentDiagnostics.wallTimeMs',
          credits: '$documentDiagnostics.credits',
          pageCount: '$documentDiagnostics.pageCount',
          renderAttempts: {
            $map: {
              input: '$renderAttempts',
              as: 'attempt',
              in: {
                outcome: '$$attempt.outcome',
                billed: '$$attempt.billed',
                units: '$$attempt.units',
                timedOut: '$$attempt.timedOut',
                phase: '$$attempt.phase',
              },
            },
          },
        },
      },
    ];
    return this.workflowRunModel.aggregate<DocumentRunRow>(pipeline).exec();
  }
}
