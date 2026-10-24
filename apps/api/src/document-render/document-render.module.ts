import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { DocumentRendererService } from './document-renderer.service';
import { FontInlinerService } from './font-inliner.service';
import { RenderSlots, renderSlotsSettings } from './render-slots';

@Module({
  imports: [RedisModule],
  providers: [
    {
      provide: RenderSlots,
      inject: [ConfigService, RedisService],
      // A bad BROWSERLESS_MAX_CONCURRENT_SESSIONS or
      // BROWSERLESS_SLOT_WAIT_MAX_MS fails the boot, naming the key.
      useFactory: (config: ConfigService, redis: RedisService) =>
        new RenderSlots({
          ...renderSlotsSettings(config),
          redis: redis.getClient(),
          logger: new Logger(RenderSlots.name),
        }),
    },
    DocumentRendererService,
    FontInlinerService,
  ],
  exports: [DocumentRendererService, FontInlinerService],
})
export class DocumentRenderModule {}
