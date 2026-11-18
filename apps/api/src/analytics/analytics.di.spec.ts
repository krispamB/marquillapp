jest.mock(
  '../auth/clerk',
  () => {
    class ClerkAuthGuard {
      canActivate() {
        return true;
      }
    }
    return { ClerkAuthGuard };
  },
  { virtual: true },
);

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { EncryptionService } from '../encryption/encryption.service';
import { RedisService } from '../redis/redis.service';
import { AnalyticsModule } from './analytics.module';
import { AnalyticsService } from './analytics.service';

// Stands in for the global modules AppModule provides (database, encryption, Redis).
@Global()
@Module({
  providers: [
    { provide: getModelToken('ConnectedAccount'), useValue: {} },
    { provide: getModelToken('Post'), useValue: {} },
    { provide: getModelToken('Artifact'), useValue: {} },
    { provide: EncryptionService, useValue: {} },
    { provide: RedisService, useValue: { getClient: () => ({}) } },
  ],
  exports: [
    getModelToken('ConnectedAccount'),
    getModelToken('Post'),
    getModelToken('Artifact'),
    EncryptionService,
    RedisService,
  ],
})
class GlobalStubsModule {}

describe('AnalyticsModule DI', () => {
  it('should resolve the module, its service and its guarded controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
        GlobalStubsModule,
        AnalyticsModule,
      ],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    expect(moduleRef.get(AnalyticsService)).toBeDefined();
    await app.close();
  });
});
