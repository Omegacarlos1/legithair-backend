import type { Server as HttpServer } from 'node:http';
import type { Pool } from 'mysql2/promise';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { AuthService } from '../auth/service.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { AppError } from '../http/errors.js';
import { SupportOutboxPublisher } from './outbox-publisher.js';
import { SupportService } from './service.js';

interface AckSuccess<T extends object> { ok: true; data: T }
interface AckFailure { ok: false; error: { code: string; message: string } }
type Ack<T extends object> = (response: AckSuccess<T> | AckFailure) => void;
interface ClientEvents {
  'support:join': (payload: unknown, ack: Ack<{ thread: object; messages: object[]; nextAfterMessageId: string | null }>) => void;
  'support:leave': (payload: unknown, ack: Ack<Record<string, never>>) => void;
  'support:message': (payload: unknown, ack: Ack<{ message: object; idempotentReplay: boolean }>) => void;
}
interface ServerEvents { 'support:message': (event: { eventId: string; message: object }) => void }
interface SocketData { token: string; user: AuthenticatedUser }

const joinSchema = z.object({ threadId: z.uuid(), afterMessageId: z.string().regex(/^\d+$/).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict();
const leaveSchema = z.object({ threadId: z.uuid() }).strict();
const messageSchema = z.object({ threadId: z.uuid(), clientId: z.uuid(), body: z.string().trim().min(1).max(4000) }).strict();

export interface SupportSocketRuntime {
  io: Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>;
  publisher: SupportOutboxPublisher;
  start(): void;
  stop(): void;
  close(): Promise<void>;
}

export function createSupportSocketRuntime(httpServer: HttpServer, pool: Pool, logger: Logger, options: { pollMilliseconds?: number; lockTimeoutSeconds?: number } = {}): SupportSocketRuntime {
  const io = new Server<ClientEvents, ServerEvents, Record<string, never>, SocketData>(httpServer, {
    connectionStateRecovery: { maxDisconnectionDuration: 120_000, skipMiddlewares: false }
  });
  const auth = new AuthService(pool);
  const support = new SupportService(pool);
  const publisher = new SupportOutboxPublisher(pool, { emitToThread: (threadId, event): void => { io.to(room(threadId)).emit('support:message', event); } }, logger, options.lockTimeoutSeconds ?? 30);

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== 'string' || token.length < 20) { next(socketError('UNAUTHENTICATED', 'Authentication is required')); return; }
    auth.authenticate(token).then((user) => { socket.data = { token, user }; next(); }).catch(() => next(socketError('UNAUTHENTICATED', 'Authentication is required')));
  });

  io.on('connection', (socket) => {
    socket.on('support:join', (payload, ack) => { void handle(socket, ack, async () => {
      const input = joinSchema.parse(payload);
      const actor = await currentActor(socket, auth);
      const thread = await support.getThread(actor, input.threadId);
      await socket.join(room(input.threadId));
      const history = await support.listMessages(actor, input.threadId, { afterMessageId: input.afterMessageId, limit: input.limit });
      return { thread, messages: history.messages, nextAfterMessageId: history.nextAfterMessageId };
    }); });
    socket.on('support:leave', (payload, ack) => { void handle(socket, ack, async () => {
      const input = leaveSchema.parse(payload);
      await socket.leave(room(input.threadId));
      return {};
    }); });
    socket.on('support:message', (payload, ack) => { void handle(socket, ack, async () => {
      const input = messageSchema.parse(payload);
      if (!socket.rooms.has(room(input.threadId))) throw new AppError(403, 'SUPPORT_THREAD_NOT_JOINED', 'Join the authorized support thread before sending a message');
      const actor = await currentActor(socket, auth);
      const result = await support.createMessage(actor, input.threadId, { clientId: input.clientId, body: input.body });
      void publisher.publishAvailable().catch((error) => logger.error({ err: error }, 'Immediate support outbox flush failed'));
      return result;
    }); });
  });

  return {
    io,
    publisher,
    start: () => publisher.start(options.pollMilliseconds ?? 250),
    stop: () => publisher.stop(),
    close: async (): Promise<void> => { publisher.stop(); await new Promise<void>((resolve) => io.close(() => resolve())); }
  };
}

async function currentActor(socket: Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>, auth: AuthService): Promise<AuthenticatedUser> {
  const user = await auth.authenticate(socket.data.token);
  socket.data.user = user;
  return user;
}

async function handle<T extends object>(socket: Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>, ack: Ack<T>, action: () => Promise<T>): Promise<void> {
  try { ack({ ok: true, data: await action() }); }
  catch (error) {
    const failure = apiError(error);
    ack({ ok: false, error: failure });
    if (failure.code === 'UNAUTHENTICATED') socket.disconnect(true);
  }
}

function apiError(error: unknown): { code: string; message: string } {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return { code: 'VALIDATION_ERROR', message: 'Socket event validation failed' };
  return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
}
function socketError(code: string, message: string): Error { const error = new Error(message) as Error & { data?: object }; error.data = { code }; return error; }
function room(threadId: string): string { return `support:thread:${threadId}`; }
