import { CarouselTemplatesService } from './carousel-templates.service';
import { Slide } from './schemas';

const makeService = () => {
  const service = new CarouselTemplatesService();
  const fixtures = {
    slides: [
      { type: 'cover', fields: { title: 'A hook' } },
      { type: 'content', fields: { heading: 'H', body: 'B' } },
    ] as Slide[],
  };
  return { service, fixtures };
};

describe('CarouselTemplatesService', () => {
  let service: CarouselTemplatesService;
  let fixtures: ReturnType<typeof makeService>['fixtures'];

  beforeEach(() => {
    ({ service, fixtures } = makeService());
  });

  describe('onModuleInit', () => {
    it('should compile the real template set without throwing', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });
  });

  describe('assembleHtml', () => {
    it('should assemble a document once templates are loaded', () => {
      service.onModuleInit();

      const html = service.assembleHtml('bold', fixtures.slides);

      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<section class="slide slide--cover">');
      expect(html).toContain('<section class="slide slide--content">');
    });

    it('should throw when called before templates are loaded', () => {
      expect(() => service.assembleHtml('bold', fixtures.slides)).toThrow(
        /not been loaded/i,
      );
    });
  });
});
