import { Global, Module } from '@nestjs/common';
import { YoutubeTranscriptService } from './youtube-transcript.service';

@Global()
@Module({
  providers: [YoutubeTranscriptService],
  exports: [YoutubeTranscriptService],
})
export class YoutubeTranscriptModule {}
