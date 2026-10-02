import { Module } from '@nestjs/common';
import { DocumentRendererService } from './document-renderer.service';

@Module({
  providers: [DocumentRendererService],
  exports: [DocumentRendererService],
})
export class DocumentRenderModule {}
