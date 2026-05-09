import { Module, Global, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule, InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  User,
  UserSchema,
  ConnectedAccount,
  ConnectedAccountSchema,
  PostDraft,
  PostDraftSchema,
  Tier,
  TierSchema,
  Subscription,
  SubscriptionSchema,
  BillingCustomer,
  BillingCustomerSchema,
  Usage,
  UsageSchema,
  OnboardingProfile,
  OnboardingProfileSchema,
} from './schemas';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: ConnectedAccount.name, schema: ConnectedAccountSchema },
      { name: PostDraft.name, schema: PostDraftSchema },
      { name: Tier.name, schema: TierSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: BillingCustomer.name, schema: BillingCustomerSchema },
      { name: Usage.name, schema: UsageSchema },
      { name: OnboardingProfile.name, schema: OnboardingProfileSchema }
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseModule.name);
  private readonly onConnected = () => this.logger.log('Database connected successfully');
  private readonly onError = (err: unknown) => this.logger.error(`Database connection error: ${err}`);

  constructor(@InjectConnection() private readonly connection: Connection) { }

  onModuleInit() {
    if (this.connection.readyState === 1) {
      this.logger.log('Database connected successfully');
    }

    this.connection.on('connected', this.onConnected);
    this.connection.on('error', this.onError);
  }

  onModuleDestroy() {
    this.connection.off('connected', this.onConnected);
    this.connection.off('error', this.onError);
  }
}
