import { Global, Module } from '@nestjs/common';
import { ActorsService } from './actors.service';
import { ApifyModule } from '../apify/apify.module';

@Global()
@Module({
  imports: [ApifyModule],
  providers: [ActorsService],
  exports: [ActorsService],
})
export class ActorsModule {}
