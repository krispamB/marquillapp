import { DynamicModule, Global, Module } from '@nestjs/common';
import { ApifyModuleOptions } from './apify.interface';
import { APIFY_CLIENT } from './apify.constants';
import { ApifyClient } from 'apify-client';
import { ApifyService } from './apify.service';

@Global()
@Module({})
export class ApifyModule {
  static register(options: ApifyModuleOptions): DynamicModule {
    return {
      module: ApifyModule,
      providers: [
        {
          provide: APIFY_CLIENT,
          useValue: new ApifyClient({ token: options.apiKey }),
        },
        ApifyService,
      ],
      exports: [ApifyService, APIFY_CLIENT],
    };
  }
}
