import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Slide } from './schemas';
import {
  CarouselThemeId,
  CompiledCarouselTemplates,
  loadCarouselTemplates,
} from './templates';

/**
 * Owns the compiled carousel templates. Compilation runs once at module init
 * and **fails the boot loudly** if any template is missing, fails to compile,
 * or contains banned unescaped-output syntax — turning the security rule into a
 * boot invariant rather than a review checkpoint. `T10`'s renderer injects this
 * for the pure `assembleHtml` half of its pipeline.
 */
@Injectable()
export class CarouselTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(CarouselTemplatesService.name);
  private templates?: CompiledCarouselTemplates;

  onModuleInit(): void {
    this.templates = loadCarouselTemplates();
    this.logger.log('Carousel templates compiled');
  }

  assembleHtml(theme: CarouselThemeId, slides: Slide[]): string {
    if (!this.templates) {
      throw new Error('Carousel templates have not been loaded');
    }
    return this.templates.assembleHtml(theme, slides);
  }
}
