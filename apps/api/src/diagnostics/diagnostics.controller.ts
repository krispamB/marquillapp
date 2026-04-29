import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { getHeapSnapshot } from 'v8';
import type { Response } from 'express';
import { AdminTokenGuard } from './admin-token.guard';

@Controller('diagnostics')
@UseGuards(AdminTokenGuard)
export class DiagnosticsController {
  @Get('heap')
  takeHeapSnapshot(@Res() res: Response) {
    const filename = `heap-${Date.now()}.heapsnapshot`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    const snapshot = getHeapSnapshot();
    snapshot.pipe(res);
  }
}
