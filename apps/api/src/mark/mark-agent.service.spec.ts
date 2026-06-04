import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MarkAgentService } from './mark-agent.service';
import { MarkSession } from './types/mark-session.types';

jest.mock('./artifact.service', () => ({
  ArtifactService: class {},
}));

jest.mock('./tools', () => ({
  createWebSearchTool: jest.fn(() => ({})),
  createValidateArtifactTool: jest.fn(() => ({})),
  createhtmlToPdfTool: jest.fn(() => ({})),
  createSaveToDbTool: jest.fn(() => ({})),
}));

jest.mock('@ai-sdk/gateway', () => ({
  createGateway: jest.fn(() => jest.fn((model: string) => ({ model }))),
}));

jest.mock('@ai-sdk/devtools', () => ({
  devToolsMiddleware: jest.fn(() => ({})),
}));

jest.mock('./utils', () => ({
  validateHtml: jest.fn(() => ({ valid: true, errors: [] })),
  validateLinkedInPost: jest.fn(() => ({ valid: true, errors: [] })),
}));

// eslint-disable-next-line no-var
var mockAgentInstance: { stream: jest.Mock };

jest.mock('ai', () => {
  mockAgentInstance = { stream: jest.fn() };
  return {
    ToolLoopAgent: jest.fn().mockImplementation(() => mockAgentInstance),
    wrapLanguageModel: jest.fn(({ model }) => model),
    stepCountIs: jest.fn((n) => ({ stepCount: n })),
    tool: jest.fn((definition) => definition),
  };
});

import { createGateway } from '@ai-sdk/gateway';
import { ToolLoopAgent } from 'ai';
import { createValidateArtifactTool } from './tools/validate_artifact.tool';

const makeSession = (overrides: Partial<MarkSession> = {}): MarkSession => ({
  userId: 'user-1',
  status: 'active',
  messages: [],
  intent: null,
  artifactId: null,
  refinementCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeService = () => {
  const sessionService = {
    getSession: jest.fn(),
    createSession: jest.fn(),
    appendMessage: jest.fn(),
    incrementRefinement: jest.fn(),
    endSession: jest.fn(),
    updateSession: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'AI_GATEWAY_API_KEY') return 'test-api-key';
      if (key === 'AI_GATEWAY_MODEL') return 'test/model';
      if (key === 'TAVILY_API_KEY') return 'test-tavily-key';
      return undefined;
    }),
  };
  const artifactService = { saveArtifact: jest.fn() };
  const service = new MarkAgentService(
    sessionService as any,
    artifactService as any,
    config as any,
  );
  return { service, mocks: { sessionService, artifactService, config } };
};

const makeFullStream = (parts: any[] = []) => ({
  [Symbol.asyncIterator]: async function* () {
    for (const part of parts) yield part;
  },
});

const makeStreamResult = (parts: any[] = []) => ({
  fullStream: makeFullStream(parts),
});

const collectEvents = async (gen: AsyncGenerator<any>) => {
  const events: any[] = [];
  for await (const e of gen) events.push(e);
  return events;
};

describe('MarkAgentService', () => {
  let service: MarkAgentService;
  let mocks: ReturnType<typeof makeService>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentInstance = { stream: jest.fn() };
    (ToolLoopAgent as jest.Mock).mockImplementation(() => mockAgentInstance);
    ({ service, mocks } = makeService());
  });

  describe('chatStream', () => {
    it('should create a new session when none exists', async () => {
      const session = makeSession();
      mocks.sessionService.getSession
        .mockRejectedValueOnce(new NotFoundException())
        .mockResolvedValueOnce(session);
      mocks.sessionService.createSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      const events = await collectEvents(service.chatStream('user-1', 'hi'));

      expect(mocks.sessionService.createSession).toHaveBeenCalledWith('user-1');
      expect(events.at(-1)).toEqual({ type: 'done', artifact: null });
    });

    it('should reuse existing session and include full message history', async () => {
      const session = makeSession({
        messages: [
          {
            role: 'user',
            content: 'first msg',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      await collectEvents(service.chatStream('user-1', 'second msg'));

      expect(mocks.sessionService.createSession).not.toHaveBeenCalled();
      const streamCallArgs = mockAgentInstance.stream.mock.calls[0][0];
      expect(streamCallArgs.messages).toHaveLength(1);
      expect(streamCallArgs.messages[0]).toEqual({
        role: 'user',
        content: 'first msg',
      });
    });

    it('should throw UnprocessableEntityException when refinement limit is reached', async () => {
      const session = makeSession({
        refinementCount: 1,
        artifactId: 'artifact-123',
      });
      mocks.sessionService.getSession.mockResolvedValue(session);

      await expect(
        collectEvents(service.chatStream('user-1', 'another try')),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ToolLoopAgent).not.toHaveBeenCalled();
    });

    it('should construct ToolLoopAgent with instructions and model', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      await collectEvents(service.chatStream('user-1', 'write a post'));

      expect(ToolLoopAgent).toHaveBeenCalledTimes(1);
      const constructorArg = (ToolLoopAgent as jest.Mock).mock.calls[0][0];
      expect(constructorArg.instructions).toBeDefined();
      expect(constructorArg.model).toBeDefined();
      expect(constructorArg.stopWhen).toBeDefined();
      expect(createGateway).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    });

    it('should register current artifact workflow tools on the agent', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      await collectEvents(service.chatStream('user-1', 'write a post'));

      const constructorArg = (ToolLoopAgent as jest.Mock).mock.calls[0][0];
      expect(constructorArg.tools).toHaveProperty('web_search');
      expect(constructorArg.tools).toHaveProperty('validate_artifact');
      expect(constructorArg.tools).toHaveProperty('html_to_pdf');
      expect(constructorArg.tools).toHaveProperty('save_to_db');
      expect(constructorArg.tools).not.toHaveProperty('generate_artifact');
      expect(Object.keys(constructorArg.tools)).toHaveLength(4);
    });

    it('should instantiate artifact workflow tools with expected dependencies', async () => {
      const {
        createWebSearchTool,
        createValidateArtifactTool: mockValidateTool,
        createhtmlToPdfTool,
        createSaveToDbTool: mockSaveToDbTool,
      } = require('./tools');
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      await collectEvents(service.chatStream('user-1', 'write a post'));

      expect(createWebSearchTool).toHaveBeenCalledWith('test-tavily-key');
      expect(mockValidateTool).toHaveBeenCalledWith();
      expect(createhtmlToPdfTool).toHaveBeenCalledWith();
      expect(mockSaveToDbTool).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should yield tool-start event on tool-input-start', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          { type: 'tool-input-start', id: 'c1', toolName: 'web_search' },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'web_search',
            output: {},
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post about AI'),
      );

      expect(events[0]).toEqual({
        type: 'tool',
        event: '[on_tool_start] web_search',
      });
      expect(events[1]).toEqual({
        type: 'tool',
        event: '[on_tool_end] web_search',
      });
    });

    it('should emit artifact-chunk events for validate_artifact tool-input-delta', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          { type: 'tool-input-start', id: 'c2', toolName: 'validate_artifact' },
          {
            type: 'tool-input-delta',
            id: 'c2',
            delta: '{"type":"text","content":"',
          },
          { type: 'tool-input-delta', id: 'c2', delta: 'Hello LinkedIn' },
          {
            type: 'tool-call',
            toolCallId: 'c2',
            toolName: 'validate_artifact',
            input: { type: 'text', content: 'Hello LinkedIn' },
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'validate_artifact',
            output: { valid: true, errors: [] },
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post'),
      );

      expect(events).toContainEqual({
        type: 'artifact-chunk',
        text: '{"type":"text","content":"',
      });
      expect(events).toContainEqual({
        type: 'artifact-chunk',
        text: 'Hello LinkedIn',
      });
    });

    it('should not emit artifact-chunk for tool-input-delta from other tools', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          { type: 'tool-input-start', id: 'c1', toolName: 'web_search' },
          {
            type: 'tool-input-delta',
            id: 'c1',
            delta: '{"query":"AI trends"}',
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'web_search',
            output: {},
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post'),
      );

      expect(events.some((e) => e.type === 'artifact-chunk')).toBe(false);
    });

    it('should capture post artifact from validate_artifact tool-call input and include it in done event', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          {
            type: 'tool-call',
            toolCallId: 'c2',
            toolName: 'validate_artifact',
            input: { type: 'text', content: 'Hello LinkedIn' },
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'validate_artifact',
            output: { valid: true, errors: [] },
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post'),
      );

      expect(events.at(-1)).toEqual({
        type: 'done',
        artifact: { type: 'post', content: 'Hello LinkedIn' },
      });
    });

    it('should normalize poll and document artifact outputs to public artifact payloads', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream
        .mockResolvedValueOnce(
          makeStreamResult([
            {
              type: 'tool-call',
              toolCallId: 'poll-call',
              toolName: 'validate_artifact',
              input: {
                type: 'structured',
                content: {
                  question: 'Best content format?',
                  options: ['Posts', 'Polls'],
                },
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'poll-call',
              toolName: 'validate_artifact',
              output: { valid: true, errors: [] },
            },
          ]),
        )
        .mockResolvedValueOnce(
          makeStreamResult([
            {
              type: 'tool-call',
              toolCallId: 'doc-call',
              toolName: 'validate_artifact',
              input: {
                type: 'html',
                content: '<html><body>Hi</body></html>',
                format: 'one-pager',
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'doc-call',
              toolName: 'validate_artifact',
              output: { valid: true, errors: [] },
            },
          ]),
        );

      const pollEvents = await collectEvents(
        service.chatStream('user-1', 'write a poll'),
      );
      const documentEvents = await collectEvents(
        service.chatStream('user-1', 'write a document'),
      );

      expect(pollEvents.at(-1)).toEqual({
        type: 'done',
        artifact: {
          type: 'poll',
          question: 'Best content format?',
          options: ['Posts', 'Polls'],
        },
      });
      expect(documentEvents.at(-1)).toEqual({
        type: 'done',
        artifact: {
          type: 'document',
          html: '<html><body>Hi</body></html>',
          format: 'one-pager',
        },
      });
    });

    it('should capture artifact from the last validate_artifact call when retried', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          {
            type: 'tool-call',
            toolCallId: 'v1',
            toolName: 'validate_artifact',
            input: { type: 'text', content: 'First attempt' },
          },
          {
            type: 'tool-result',
            toolCallId: 'v1',
            toolName: 'validate_artifact',
            output: { valid: false, errors: ['Too long'] },
          },
          {
            type: 'tool-call',
            toolCallId: 'v2',
            toolName: 'validate_artifact',
            input: { type: 'text', content: 'Revised attempt' },
          },
          {
            type: 'tool-result',
            toolCallId: 'v2',
            toolName: 'validate_artifact',
            output: { valid: true, errors: [] },
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post'),
      );

      expect(events.at(-1)).toEqual({
        type: 'done',
        artifact: { type: 'post', content: 'Revised attempt' },
      });
    });

    it('should yield done with artifact null when validate_artifact is not called', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      const events = await collectEvents(service.chatStream('user-1', 'hi'));

      expect(events.at(-1)).toEqual({ type: 'done', artifact: null });
    });

    it('should always yield done as the last event', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      const events = await collectEvents(service.chatStream('user-1', 'hi'));

      expect(events.at(-1)?.type).toBe('done');
    });

    it('should yield tool-error event when a tool-error part is received', async () => {
      const session = makeSession();
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(
        makeStreamResult([
          {
            type: 'tool-error',
            toolCallId: 'c1',
            toolName: 'web_search',
            error: new Error('fetch failed'),
          },
        ]),
      );

      const events = await collectEvents(
        service.chatStream('user-1', 'write a post'),
      );

      expect(events[0]).toEqual({
        type: 'tool-error',
        toolName: 'web_search',
        error: 'fetch failed',
      });
      expect(events.at(-1)).toEqual({ type: 'done', artifact: null });
    });

    it('should allow refinement when artifactId is null even with refinementCount >= 1', async () => {
      const session = makeSession({ refinementCount: 1, artifactId: null });
      mocks.sessionService.getSession.mockResolvedValue(session);
      mocks.sessionService.appendMessage.mockResolvedValue(undefined);
      mockAgentInstance.stream.mockResolvedValue(makeStreamResult());

      await expect(
        collectEvents(service.chatStream('user-1', 'refine this')),
      ).resolves.toBeDefined();
    });
  });

  describe('createOrResetSession', () => {
    it('should delegate to sessionService.createSession', async () => {
      const session = makeSession();
      mocks.sessionService.createSession.mockResolvedValue(session);

      const result = await service.createOrResetSession('user-1');

      expect(mocks.sessionService.createSession).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(session);
    });
  });

  describe('endSession', () => {
    it('should delegate to sessionService.endSession', async () => {
      const session = makeSession({ status: 'completed' });
      mocks.sessionService.endSession.mockResolvedValue(session);

      const result = await service.endSession('user-1');

      expect(mocks.sessionService.endSession).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(session);
    });
  });
});

describe('createValidateArtifactTool', () => {
  const executeValidate = async (input: unknown) =>
    (createValidateArtifactTool() as any).execute(input);

  it('should validate a structured poll object without requiring JSON string content', async () => {
    const result = await executeValidate({
      type: 'structured',
      content: {
        question: 'Which format works best?',
        options: ['Post', 'Poll'],
      },
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('should return validation errors for invalid structured poll objects', async () => {
    const result = await executeValidate({
      type: 'structured',
      content: {
        question: 'x'.repeat(141),
        options: [
          'This option is definitely longer than thirty characters',
          'Short',
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Question exceeds 140 characters (141).',
        expect.stringContaining('Option 1 exceeds 30 characters'),
      ]),
    );
  });
});
