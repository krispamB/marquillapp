import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGateway } from '@ai-sdk/gateway';
import { ToolLoopAgent, wrapLanguageModel, stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';
import { MarkSessionService } from './mark-session.service';
import { ArtifactService } from './artifact.service';
import {
  ArtifactPayload,
  MarkChatEvent,
  MarkSession,
  PendingClarification,
} from './types/mark-session.types';
import { buildOrchestratorPrompt } from './prompts/mark-orchestrator.prompt';
import {
  createWebSearchTool,
  createValidateArtifactTool,
  createhtmlToPdfTool,
  createSaveToDbTool,
  createAskSpecificationTool,
} from './tools';
import { devToolsMiddleware } from '@ai-sdk/devtools';

type ValidateArtifactInput =
  | { type: 'text'; content: string }
  | { type: 'structured'; content: { question: string; options: string[] } }
  | { type: 'html'; content: string; format?: 'one-pager' | 'carousel' };

const normalizeArtifactOutput = (input: unknown): ArtifactPayload | null => {
  const artifact = input as Partial<ValidateArtifactInput>;

  if (artifact.type === 'text' && typeof artifact.content === 'string') {
    return { type: 'post', content: artifact.content };
  }

  if (
    artifact.type === 'structured' &&
    typeof artifact.content === 'object' &&
    artifact.content !== null &&
    'question' in artifact.content &&
    'options' in artifact.content
  ) {
    const content = artifact.content as { question: string; options: string[] };
    return {
      type: 'poll',
      question: content.question,
      options: content.options,
    };
  }

  if (artifact.type === 'html' && typeof artifact.content === 'string') {
    return {
      type: 'document',
      html: artifact.content,
      format: artifact.format === 'carousel' ? 'carousel' : 'one-pager',
    };
  }

  return null;
};

@Injectable()
export class MarkAgentService {
  constructor(
    private readonly sessionService: MarkSessionService,
    private readonly artifactService: ArtifactService,
    private readonly config: ConfigService,
  ) { }

  async *chatStream(
    userId: string,
    userMessage: string,
  ): AsyncGenerator<MarkChatEvent> {
    let session: MarkSession;
    try {
      session = await this.sessionService.getSession(userId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        session = await this.sessionService.createSession(userId);
      } else {
        throw err;
      }
    }

    if (session.refinementCount >= 1 && session.artifactId !== null) {
      throw new UnprocessableEntityException(
        'Refinement limit reached. Continue editing in the artifact editor.',
      );
    }

    let messages: ModelMessage[];

    if (session.pendingClarification !== null) {
      // Resume the agent loop by injecting the user's answer as a tool-result
      const pending = session.pendingClarification;
      messages = [
        ...pending.sdkMessages,
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: pending.toolCallId,
              toolName: 'ask_clearification',
              output: { type: 'text', value: userMessage },
            },
          ],
        },
      ];
      await this.sessionService.updateSession(userId, {
        pendingClarification: null,
      });
      // Record the user message in UI history
      await this.sessionService.appendMessage(userId, {
        role: 'user',
        content: userMessage,
      });
    } else {
      await this.sessionService.appendMessage(userId, {
        role: 'user',
        content: userMessage,
      });
      const updatedSession = await this.sessionService.getSession(userId);
      messages = updatedSession.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
    }

    const gateway = createGateway({
      apiKey: this.config.get<string>('AI_GATEWAY_API_KEY'),
    });
    const model = this.config.get<string>('AI_GATEWAY_MODEL')!;
    const middleware = process.env.NODE_ENV === 'development'
      ? [devToolsMiddleware()]
      : [];

    const languageModel = wrapLanguageModel({
      model: gateway(model),
      middleware,
    });
    const tavilyKey = this.config.get<string>('TAVILY_API_KEY')!;
    const agent = new ToolLoopAgent({
      model: languageModel,
      instructions: buildOrchestratorPrompt(
        new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      ),
      stopWhen: stepCountIs(8),
      tools: {
        web_search: createWebSearchTool(tavilyKey),
        ask_clearification: createAskSpecificationTool(),
        validate_artifact: createValidateArtifactTool(),
        html_to_pdf: createhtmlToPdfTool(),
        save_to_db: createSaveToDbTool((params) =>
          this.artifactService.saveArtifact(userId, params),
        ),
      },
    });

    const result = await agent.stream({ messages });

    let artifact: ArtifactPayload | null = null;
    let artifactToolCallId: string | null = null;

    for await (const part of result.fullStream) {
      if (part.type === 'tool-input-start') {
        const p = part as unknown as {
          type: 'tool-input-start';
          id: string;
          toolName: string;
        };
        yield { type: 'tool', event: `[on_tool_start] ${p.toolName}` };
        if (p.toolName === 'validate_artifact') {
          artifactToolCallId = p.id;
        }
      } else if (part.type === 'tool-input-delta') {
        const p = part as unknown as {
          type: 'tool-input-delta';
          id: string;
          delta: string;
        };
        if (p.id === artifactToolCallId) {
          yield { type: 'artifact-chunk', text: p.delta };
        }
      } else if (part.type === 'tool-call') {
        const p = part as unknown as {
          type: 'tool-call';
          toolCallId: string;
          toolName: string;
          input: unknown;
        };
        if (p.toolName === 'validate_artifact') {
          artifact = normalizeArtifactOutput(p.input);
        }
      } else if (part.type === 'tool-result') {
        yield { type: 'tool', event: `[on_tool_end] ${part.toolName}` };
      } else if (part.type === 'tool-error') {
        const { toolName, error } = part as {
          toolName: string;
          error: unknown;
        };
        yield {
          type: 'tool-error',
          toolName,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // After the stream, use the resolved Promises — more reliable than stream events.
    // result.toolCalls is the last step's tool calls; the clarification tool, if called,
    // always lands in the last step because the loop stops when it has no execute function.
    const toolCalls = await result.toolCalls;
    const clarificationTC = toolCalls.find(
      (tc) => tc.toolName === 'ask_clearification',
    );

    if (clarificationTC !== undefined) {
      const input = clarificationTC.input as {
        questions: { question: string; options: string[] }[];
        summary: string;
      };
      // Reconstruct the full SDK message history: original input + all step response messages.
      // We use result.steps so multi-step runs (e.g. web search → clarification) are covered.
      const steps = await result.steps;
      const sdkMessages: ModelMessage[] = [
        ...messages,
        ...steps.flatMap((s) => s.response.messages as ModelMessage[]),
      ];
      const pending: PendingClarification = {
        toolCallId: clarificationTC.toolCallId,
        questions: input.questions,
        summary: input.summary,
        sdkMessages,
      };
      await this.sessionService.updateSession(userId, {
        pendingClarification: pending,
      });
      yield {
        type: 'clarification',
        questions: input.questions,
        summary: input.summary,
      };
      return;
    }

    const currentSession = await this.sessionService.getSession(userId);
    if (currentSession.artifactId !== null) {
      await this.sessionService.incrementRefinement(userId);
    }

    yield { type: 'done', artifact };
  }

  async createOrResetSession(userId: string): Promise<MarkSession> {
    return this.sessionService.createSession(userId);
  }

  async endSession(userId: string): Promise<MarkSession> {
    return this.sessionService.endSession(userId);
  }
}
