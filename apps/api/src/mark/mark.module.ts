import { Module } from '@nestjs/common';
import { ArtifactService } from './artifact.service';

// The Mark agent (orchestrator, websocket gateway, provider abstraction and
// token calculator) was removed. What remains is a dormant toolkit: artifact
// persistence plus the html/pdf/validation utils and the searchWeb helper.
// The Artifact model is registered globally by DatabaseModule, so no imports
// are needed here.
@Module({
  providers: [ArtifactService],
  exports: [ArtifactService],
})
export class MarkModule {}
