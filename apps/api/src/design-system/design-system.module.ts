import { Module } from '@nestjs/common';
import { DesignSystemsController } from './design-systems.controller';
import { DesignSystemsService } from './design-systems.service';

/**
 * App-owned Design Systems. Imported by `AppModule`, so the API and the worker
 * both verify the seeds at boot.
 */
@Module({
  controllers: [DesignSystemsController],
  providers: [DesignSystemsService],
  exports: [DesignSystemsService],
})
export class DesignSystemModule {}
