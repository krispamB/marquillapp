import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InputDto } from './input.dto';
import { ContentType } from '../../workflow/workflow.constants';
import { StylePreset } from '../style-presets.config';

describe('InputDto', () => {
  it('accepts payload without stylePreset', async () => {
    const dto = plainToInstance(InputDto, {
      input: 'Write about shipping velocity',
      contentType: ContentType.QUICK_POST_LINKEDIN,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts payload with valid stylePreset', async () => {
    const dto = plainToInstance(InputDto, {
      input: 'Write about shipping velocity',
      contentType: ContentType.QUICK_POST_LINKEDIN,
      stylePreset: StylePreset.STORYTELLING,
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects payload with invalid stylePreset', async () => {
    const dto = plainToInstance(InputDto, {
      input: 'Write about shipping velocity',
      contentType: ContentType.QUICK_POST_LINKEDIN,
      stylePreset: 'casual-funny',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((error) => error.property === 'stylePreset')).toBe(true);
  });
});
