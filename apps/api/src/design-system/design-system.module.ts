import { Module } from '@nestjs/common';
import { DesignSystemsService } from './design-systems.service';

/**
 * App-owned Design Systems. Imported by `AppModule`, so the API and the worker
 * both verify the seeds at boot.
 */
@Module({
  providers: [DesignSystemsService],
  exports: [DesignSystemsService],
})
export class DesignSystemModule {}
