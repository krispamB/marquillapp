import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient, ClerkClient } from '@clerk/backend';

export const CLERK_CLIENT = 'CLERK_CLIENT';

export const clerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService): ClerkClient =>
    createClerkClient({
      secretKey: configService.getOrThrow<string>('CLERK_SECRET_KEY'),
      publishableKey: configService.getOrThrow<string>(
        'CLERK_PUBLISHABLE_KEY',
      ),
    }),
};
