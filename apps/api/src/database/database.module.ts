import { Module, Global, Logger, OnModuleInit } from '@nestjs/common';
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
} from './schemas';

@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
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
    ]),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@InjectConnection() private readonly connection: Connection) { }

  onModuleInit() {
    if (this.connection.readyState === 1) {
      this.logger.log('Database connected successfully');
    }

    this.connection.on('connected', () => {
      this.logger.log('Database connected successfully');
    });

    this.connection.on('error', (err) => {
      this.logger.error(`Database connection error: ${err}`);
    });
  }
}
