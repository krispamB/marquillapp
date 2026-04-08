import { createLinkedinDraftStep } from './createLinkedinDraft.step';
import { ContentType } from '../workflow.constants';
import {
  StylePreset,
  STYLE_PRESET_INSTRUCTIONS,
} from '../../agent/style-presets.config';

describe('createLinkedinDraftStep', () => {
  const baseIntent = {
    primary_goal: 'Teach a practical lesson',
    secondary_goal: ['Build trust'],
    audience: 'Engineering leaders',
    domain: 'Software engineering',
    topic_Scope: ['Delivery'],
    time_horizon: 'evergreen',
    content_depth: 'practical',
    tone: 'professional',
    format_preferences: ['post'],
    success_criteria: ['clarity'],
    ambiguity_flags: [],
  };

  it('injects selected style context when style preset is provided', async () => {
    const createLinkedInPost = jest.fn().mockResolvedValue('generated-draft');
    const updateDraft = jest.fn().mockResolvedValue(undefined);
    const logger = { log: jest.fn(), error: jest.fn() };

    const state = {
      data: undefined,
      initialInput: {
        input: 'Generate a post',
        contentType: ContentType.QUICK_POST_LINKEDIN,
        stylePreset: StylePreset.STORYTELLING,
      },
      metadata: {
        intent: baseIntent,
      },
    };

    const result = await createLinkedinDraftStep(
      state as any,
      { id: 'job-1' } as any,
      { agentService: { createLinkedInPost, updateDraft }, logger } as any,
    );

    expect(createLinkedInPost).toHaveBeenCalledWith(
      expect.objectContaining({
        selected_style: StylePreset.STORYTELLING,
        selected_style_instruction:
          STYLE_PRESET_INSTRUCTIONS[StylePreset.STORYTELLING],
      }),
    );
    expect(updateDraft).toHaveBeenCalledWith('job-1', {
      content: 'generated-draft',
    });
    expect(result.data).toBe('generated-draft');
  });

  it('keeps generation flow unchanged when style preset is absent', async () => {
    const createLinkedInPost = jest.fn().mockResolvedValue('generated-draft');
    const updateDraft = jest.fn().mockResolvedValue(undefined);
    const logger = { log: jest.fn(), error: jest.fn() };
    const compressionResult = { core_thesis: 'x' };

    await createLinkedinDraftStep(
      {
        data: compressionResult,
        initialInput: {
          input: 'Generate a post',
          contentType: ContentType.INSIGHT_POST_LINKEDIN,
        },
        metadata: {
          intent: baseIntent,
        },
      } as any,
      { id: 'job-1' } as any,
      { agentService: { createLinkedInPost, updateDraft }, logger } as any,
    );

    const firstArg = createLinkedInPost.mock.calls[0][0];
    expect(firstArg.selected_style).toBeUndefined();
    expect(firstArg.selected_style_instruction).toBeUndefined();
    expect(createLinkedInPost).toHaveBeenCalledWith(
      expect.objectContaining(baseIntent),
      compressionResult,
    );
  });
});
