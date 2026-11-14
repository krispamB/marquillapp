import { Module } from '@nestjs/common';
import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { LinkedinAnalyticsClient } from './linkedin-analytics.client';

// Mongoose models (DatabaseModule), EncryptionService, RedisService and the
// throttler are global, so nothing needs importing here.
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCacheService, LinkedinAnalyticsClient],
})
export class AnalyticsModule {}
