import type { AuthenticatedUser } from '../auth/types.js';

export type SupportActor = AuthenticatedUser;

export interface CreateThreadInput {
  subject: string;
  message: string;
  clientId: string;
}

export interface CreateMessageInput {
  body: string;
  clientId: string;
}

export interface MessagePage {
  afterMessageId?: string;
  limit: number;
}
