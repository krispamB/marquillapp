import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { User } from '../database/schemas';
import { MarkAgentService } from './mark-agent.service';
import { MarkSessionService } from './mark-session.service';

@WebSocketGateway({
  namespace: 'mark',
  cors: { origin: true, credentials: true },
})
export class MarkGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly agentService: MarkAgentService,
    private readonly sessionService: MarkSessionService,
    private readonly jwtService: JwtService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async handleConnection(client: Socket) {
    const user = await this.authenticate(client);
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
      return;
    }
    client.data.user = user;
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('chat')
  async handleChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { message: string },
  ) {
    const userId = (client.data.user as User)._id.toString();
    try {
      for await (const event of this.agentService.chatStream(
        userId,
        body.message,
      )) {
        if (event.type === 'tool') {
          client.emit('tool', { event: event.event });
        } else if (event.type === 'artifact-chunk') {
          client.emit('artifact-chunk', { text: event.text });
        } else if (event.type === 'tool-error') {
          client.emit('tool-error', {
            toolName: event.toolName,
            error: event.error,
          });
        } else if (event.type === 'clarification') {
          client.emit('clarification', {
            questions: event.questions,
            summary: event.summary,
          });
        } else if (event.type === 'done') {
          client.emit('done', { artifact: event.artifact });
        }
      }
    } catch (err) {
      client.emit('error', {
        message: err instanceof Error ? err.message : 'Chat failed',
      });
    }
  }

  @SubscribeMessage('session:create')
  async handleCreateSession(@ConnectedSocket() client: Socket) {
    const userId = (client.data.user as User)._id.toString();
    const session = await this.sessionService.createSession(userId);
    client.emit('session', session);
  }

  @SubscribeMessage('session:end')
  async handleEndSession(@ConnectedSocket() client: Socket) {
    const userId = (client.data.user as User)._id.toString();
    const session = await this.sessionService.endSession(userId);
    client.emit('session', session);
  }

  private async authenticate(client: Socket): Promise<User | null> {
    try {
      const token = this.extractToken(client);
      if (!token) return null;
      const payload = this.jwtService.verify<{ sub: string }>(token);
      const user = await this.userModel.findById(payload.sub).populate('tier');
      return user ?? null;
    } catch {
      return null;
    }
  }

  private extractToken(client: Socket): string | null {
    if (client.handshake.auth?.token)
      return String(client.handshake.auth.token);
    const cookies = client.handshake.headers.cookie ?? '';
    const match = cookies.match(/access_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}
