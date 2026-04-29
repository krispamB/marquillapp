import { Module } from '@nestjs/common';
import { DiagnosticsController } from './diagnostics.controller';
import { AdminTokenGuard } from './admin-token.guard';

@Module({
  controllers: [DiagnosticsController],
  providers: [AdminTokenGuard],
})
export class DiagnosticsModule {}
