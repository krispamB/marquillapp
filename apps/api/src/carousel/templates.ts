import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Handlebars from 'handlebars';
import type { CarouselTheme } from '../database/schemas';
import { Slide, SlideType, slideTypes } from './schemas';

/**
 * A deck theme as its string value. Typed off the DB `CarouselTheme` enum but
 * as a **type-only** reference, so this pure, browserless-free module never
 * pulls the mongoose layer into its runtime (or its tests). A string-enum
 * member is assignable to its value, so callers holding the DB enum pass
 * straight through.
 */
export type CarouselThemeId = `${CarouselTheme}`;

/** Every carousel theme. The compile-time check below fails if this drifts
 *  from the DB enum — add a theme in both places or neither. */
export const carouselThemes = [
  'bold',
  'minimal',
  'editorial',
  'gradient',
] as const satisfies readonly CarouselThemeId[];

type AssertEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
// Compile error if `carouselThemes` and the DB `CarouselTheme` enum diverge.
const _themesMatchEnum: AssertEqual<
  (typeof carouselThemes)[number],
  CarouselThemeId
> = true;
void _themesMatchEnum;

/**
 * Typed registry mapping (theme x slide type) -> template filename, relative to
 * `assets/carousel/`. The registry deliberately carries no schemas — keying
 * those by theme would invite per-theme divergence of a contract that must stay
 * uniform. Adding a theme later is a new folder plus these entries.
 */
export type CarouselTemplateRegistry = Record<
  CarouselThemeId,
  Record<SlideType, `${string}.hbs`>
>;

export const carouselTemplateRegistry: CarouselTemplateRegistry =
  carouselThemes.reduce((registry, theme) => {
    registry[theme] = slideTypes.reduce(
      (set, type) => {
        set[type] = `templates/${theme}/${type}.hbs`;
        return set;
      },
      {} as Record<SlideType, `${string}.hbs`>,
    );
    return registry;
  }, {} as CarouselTemplateRegistry);

/**
 * Unescaped-output syntax is banned outright: triple-stache `{{{ }}}` and the
 * `{{& }}` ampersand form both bypass HTML escaping, and every slide field is
 * untrusted LLM text. Enforced at boot so the rule cannot erode as templates
 * are added.
 */
const UNESCAPED_OUTPUT = /\{\{(\{|\s*&)/;

const DEFAULT_ASSETS_ROOT = join(process.cwd(), 'assets/carousel');

const key = (theme: CarouselThemeId, type: SlideType) => `${theme}:${type}`;

export interface CompiledCarouselTemplates {
  /**
   * Pure, no I/O: apply each precompiled template to `slide.fields`, wrap in a
   * `.slide` section, and concatenate in order inside one self-contained
   * document whose `<head>` inlines `base.css` + the theme's `theme.css`.
   * Resolves zero network requests so Browserless has nothing to fetch.
   */
  assembleHtml(theme: CarouselThemeId, slides: Slide[]): string;
}

function readAsset(root: string, relativePath: string, label: string): string {
  try {
    return readFileSync(join(root, relativePath), 'utf-8');
  } catch (error) {
    throw new Error(
      `Carousel asset missing or unreadable: ${label} (${relativePath}) — ${(error as Error).message}`,
    );
  }
}

/**
 * Load and compile every `(theme, slide type)` template once, failing fast if
 * any file is missing, fails to compile, or contains unescaped-output syntax.
 * An isolated Handlebars environment is used so no globally registered helper
 * can leak a `SafeString` into a slide.
 */
export function loadCarouselTemplates(
  assetsRoot: string = DEFAULT_ASSETS_ROOT,
): CompiledCarouselTemplates {
  const handlebars = Handlebars.create();

  const baseCss = readAsset(assetsRoot, 'base.css', 'base.css');
  const themeCss = new Map<CarouselThemeId, string>();
  const compiled = new Map<string, Handlebars.TemplateDelegate>();

  for (const theme of carouselThemes) {
    themeCss.set(
      theme,
      readAsset(
        assetsRoot,
        `templates/${theme}/theme.css`,
        `${theme}/theme.css`,
      ),
    );

    for (const type of slideTypes) {
      const relativePath = carouselTemplateRegistry[theme][type];
      const label = `${theme}/${type}.hbs`;
      const source = readAsset(assetsRoot, relativePath, label);

      if (UNESCAPED_OUTPUT.test(source)) {
        throw new Error(
          `Carousel template ${label} uses banned unescaped-output syntax ({{{ }}} or {{& }}); slide fields are untrusted LLM text and must be HTML-escaped`,
        );
      }

      try {
        // Force a parse now so a syntax error surfaces at boot, not first render.
        handlebars.precompile(source);
        compiled.set(key(theme, type), handlebars.compile(source));
      } catch (error) {
        throw new Error(
          `Carousel template ${label} failed to compile: ${(error as Error).message}`,
        );
      }
    }
  }

  return {
    assembleHtml(theme, slides) {
      if (!themeCss.has(theme)) {
        throw new Error(`Unknown carousel theme: ${theme}`);
      }

      const sections = slides.map((slide) => {
        const template = compiled.get(key(theme, slide.type));
        if (!template) {
          throw new Error(`No carousel template for ${theme}/${slide.type}`);
        }
        // `slide.type` is a controlled enum value — safe in the class name.
        return `<section class="slide slide--${slide.type}">${template(
          slide.fields,
        )}</section>`;
      });

      const css = `${baseCss}\n${themeCss.get(theme) ?? ''}`;

      return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        `<style>${css}</style>`,
        '</head>',
        `<body>${sections.join('')}</body>`,
        '</html>',
      ].join('');
    },
  };
}
