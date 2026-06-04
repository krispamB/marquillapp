jest.mock('ai', () => ({ tool: jest.fn((def) => def) }), { virtual: true });

import { createSaveToDbTool } from './save_to_db.tool';

describe('createSaveToDbTool', () => {
  const makeTool = () => {
    const saveFn = jest.fn();
    const toolDef = createSaveToDbTool(saveFn) as any;
    return { toolDef, saveFn };
  };

  beforeEach(() => jest.clearAllMocks());

  it('should call saveFn with the full params and return its result', async () => {
    const { toolDef, saveFn } = makeTool();
    saveFn.mockResolvedValue({ recordId: 'abc123' });

    const params = {
      type: 'text' as const,
      title: 'Post title',
      description: 'Short desc',
      post: { content: 'Hello LinkedIn', title: 'Post title' },
    };

    const result = await toolDef.execute(params);

    expect(saveFn).toHaveBeenCalledWith(params);
    expect(result).toEqual({ recordId: 'abc123' });
  });

  it('should pass storageUrl when provided', async () => {
    const { toolDef, saveFn } = makeTool();
    saveFn.mockResolvedValue({ recordId: 'doc456' });

    const params = {
      type: 'html' as const,
      title: 'Doc',
      description: 'A one-pager',
      storageUrl: 'https://cdn.example.com/file.pdf',
    };

    await toolDef.execute(params);

    expect(saveFn).toHaveBeenCalledWith(
      expect.objectContaining({ storageUrl: params.storageUrl }),
    );
  });

  it('should propagate errors from saveFn', async () => {
    const { toolDef, saveFn } = makeTool();
    saveFn.mockRejectedValue(new Error('timeout'));

    await expect(
      toolDef.execute({ type: 'text', title: 'T', description: 'D' }),
    ).rejects.toThrow('timeout');
  });
});
