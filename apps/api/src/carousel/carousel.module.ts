import { Module } from '@nestjs/common';
import { CarouselTemplatesService } from './carousel-templates.service';
import { CarouselRendererService } from './carousel-renderer.service';

@Module({
  providers: [CarouselTemplatesService, CarouselRendererService],
  exports: [CarouselTemplatesService, CarouselRendererService],
})
export class CarouselModule {}
