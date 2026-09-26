import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
// Direct file import (not the ../auth/clerk barrel) to avoid a require cycle:
// the barrel loads ClerkAuthModule, which imports WorkflowModule.
import { ClerkAuthGuard } from '../auth/clerk/clerk-auth.guard';
import { GetUser } from '../common/decorators';
import { User } from '../database/schemas';
import { RunEventStreamService } from './run-event-stream.service';

@UseGuards(ClerkAuthGuard)
@Controller('runs')
export class RunEventsController {
  constructor(private readonly stream: RunEventStreamService) {}

  /**
   * SSE progress stream for one generation run, keyed by the `runId` the 202
   * handed the client (which is also the Redis stream key). Raw `@Res` rather
   * than `@Sse()`: the relay must read `Last-Event-ID`, return 204 before any
   * body, set anti-buffering headers, and drive the `XREAD BLOCK` loop itself —
   * all of which the Observable abstraction hides.
   */
  @Get(':runId/events')
  events(
    @Param('runId') runId: string,
    @GetUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    return this.stream.relay(runId, user._id.toString(), req, res);
  }
}
