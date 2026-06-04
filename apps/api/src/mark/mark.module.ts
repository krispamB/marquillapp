import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, UserSchema } from '../database/schemas';
import { MarkSessionService } from './mark-session.service';
import { MarkAgentService } from './mark-agent.service';
import { ArtifactService } from './artifact.service';
import { MarkGateway } from './mark.gateway';

// RedisModule and ConfigModule are @Global() — no explicit import needed
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    MarkGateway,
    MarkSessionService,
    ArtifactService,
    MarkAgentService,
  ],
  exports: [MarkSessionService, ArtifactService, MarkAgentService],
})
export class MarkModule {}
