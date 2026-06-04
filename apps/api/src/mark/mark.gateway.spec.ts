import { MarkGateway } from './mark.gateway';
import { MarkSession } from './types/mark-session.types';

jest.mock('./artifact.service', () => ({
  ArtifactService: class {},
}));

jest.mock('../database/schemas', () => ({
  User: class User {},
}));

jest.mock(
  '@nestjs/websockets',
  () => ({
    WebSocketGateway: () => () => {},
    WebSocketServer: () => () => {},
    SubscribeMessage: () => () => {},
    ConnectedSocket: () => () => {},
    MessageBody: () => () => {},
  }),
  { virtual: true },
);

jest.mock('socket.io', () => ({}), { virtual: true });

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

const makeGateway = () => {
  const agentService = { chatStream: jest.fn() };
  const sessionService = { createSession: jest.fn(), endSession: jest.fn() };
  const jwtService = { verify: jest.fn() };
  const userModel = { findById: jest.fn() };
  const gateway = new MarkGateway(
    agentService as any,
    sessionService as any,
    jwtService as any,
    userModel as any,
  );
  return {
    gateway,
    mocks: { agentService, sessionService, jwtService, userModel },
  };
};

const makeClient = (overrides: Record<string, any> = {}) => ({
  handshake: { auth: {}, headers: { cookie: '' } },
  data: {},
  emit: jest.fn(),
  disconnect: jest.fn(),
  ...overrides,
});

describe('MarkGateway', () => {
  let gateway: MarkGateway;
  let mocks: ReturnType<typeof makeGateway>['mocks'];

  beforeEach(() => {
    jest.clearAllMocks();
    ({ gateway, mocks } = makeGateway());
  });

  describe('handleConnection', () => {
    it('should disconnect client when token is missing', async () => {
      const client = makeClient();
      await gateway.handleConnection(client as any);

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Unauthorized',
      });
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should disconnect client when JWT verification fails', async () => {
      mocks.jwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const client = makeClient({
        handshake: { auth: { token: 'bad-token' }, headers: { cookie: '' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should disconnect when user is not found in db', async () => {
      mocks.jwtService.verify.mockReturnValue({ sub: 'user-1' });
      mocks.userModel.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      });
      const client = makeClient({
        handshake: { auth: { token: 'valid-token' }, headers: { cookie: '' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('should set socket.data.user when auth succeeds', async () => {
      const user = { _id: 'user-1', email: 'a@b.com' };
      mocks.jwtService.verify.mockReturnValue({ sub: 'user-1' });
      mocks.userModel.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(user),
      });
      const client = makeClient({
        handshake: { auth: { token: 'valid-token' }, headers: { cookie: '' } },
      });

      await gateway.handleConnection(client as any);

      expect(client.data.user).toEqual(user);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('should extract token from access_token cookie when auth header is absent', async () => {
      const user = { _id: 'user-1' };
      mocks.jwtService.verify.mockReturnValue({ sub: 'user-1' });
      mocks.userModel.findById.mockReturnValue({
        populate: jest.fn().mockResolvedValue(user),
      });
      const client = makeClient({
        handshake: {
          auth: {},
          headers: { cookie: 'access_token=my-jwt-token; Path=/' },
        },
      });

      await gateway.handleConnection(client as any);

      expect(mocks.jwtService.verify).toHaveBeenCalledWith('my-jwt-token');
      expect(client.data.user).toEqual(user);
    });
  });

  describe('handleChat', () => {
    it('should emit done with artifact payload from chatStream', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield {
          type: 'done' as const,
          artifact: { type: 'post' as const, content: 'Hello LinkedIn' },
        };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'write a post' });

      expect(client.emit).toHaveBeenCalledWith('done', {
        artifact: { type: 'post', content: 'Hello LinkedIn' },
      });
    });

    it('should emit done with null artifact when no artifact was created', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'hi' });

      expect(client.emit).toHaveBeenCalledWith('done', { artifact: null });
    });

    it('should forward artifact-chunk events from chatStream', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield { type: 'artifact-chunk' as const, text: '{"content":"Hello' };
        yield { type: 'artifact-chunk' as const, text: ' LinkedIn"}' };
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'write a post' });

      expect(client.emit).toHaveBeenCalledWith('artifact-chunk', {
        text: '{"content":"Hello',
      });
      expect(client.emit).toHaveBeenCalledWith('artifact-chunk', {
        text: ' LinkedIn"}',
      });
    });

    it('should never emit chunk events', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield { type: 'tool' as const, event: '[on_tool_start] plan' };
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'hi' });

      const emittedEvents = client.emit.mock.calls.map((c: any[]) => c[0]);
      expect(emittedEvents).not.toContain('chunk');
    });

    it('should emit tool events for tool-related stream parts', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield {
          type: 'tool' as const,
          event: '[on_tool_start] plan {"request":"write a post"}',
        };
        yield { type: 'tool' as const, event: '[on_tool_end] plan' };
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'write a post' });

      expect(client.emit).toHaveBeenCalledWith('tool', {
        event: '[on_tool_start] plan {"request":"write a post"}',
      });
      expect(client.emit).toHaveBeenCalledWith('tool', {
        event: '[on_tool_end] plan',
      });
    });

    it('should emit tool-error event when stream yields a tool-error', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        yield {
          type: 'tool-error' as const,
          toolName: 'plan',
          error: 'fetch failed',
        };
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'hi' });

      expect(client.emit).toHaveBeenCalledWith('tool-error', {
        toolName: 'plan',
        error: 'fetch failed',
      });
    });

    it('should emit error event when chatStream throws', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });

      async function* fakeStream() {
        throw new Error('Refinement limit reached');
        yield { type: 'done' as const, artifact: null };
      }
      mocks.agentService.chatStream.mockReturnValue(fakeStream());

      await gateway.handleChat(client as any, { message: 'again' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Refinement limit reached',
      });
    });
  });

  describe('handleCreateSession', () => {
    it('should emit session event with created session', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });
      const session = makeSession();
      mocks.sessionService.createSession.mockResolvedValue(session);

      await gateway.handleCreateSession(client as any);

      expect(mocks.sessionService.createSession).toHaveBeenCalledWith('user-1');
      expect(client.emit).toHaveBeenCalledWith('session', session);
    });
  });

  describe('handleEndSession', () => {
    it('should emit session event with ended session', async () => {
      const user = { _id: { toString: () => 'user-1' } };
      const client = makeClient({ data: { user } });
      const session = makeSession({ status: 'completed' });
      mocks.sessionService.endSession.mockResolvedValue(session);

      await gateway.handleEndSession(client as any);

      expect(mocks.sessionService.endSession).toHaveBeenCalledWith('user-1');
      expect(client.emit).toHaveBeenCalledWith('session', session);
    });
  });
});
