import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  TeachingAgentSession,
  TeachingAgentTurnResult,
} from '../contracts/teaching-agent.types';

@Injectable()
export class TeachingAgentSessionStore {
  private readonly sessions = new Map<string, TeachingAgentSession>();
  private readonly eventResults = new Map<string, TeachingAgentTurnResult>();

  create(session: TeachingAgentSession): void {
    if (this.sessions.has(session.sessionId)) {
      throw new ConflictException({
        success: false,
        code: 'TEACHING_SESSION_EXISTS',
        message: `教学会话 ${session.sessionId} 已存在。`,
      });
    }
    this.sessions.set(session.sessionId, session);
  }

  get(sessionId: string): TeachingAgentSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException({
        success: false,
        code: 'TEACHING_SESSION_NOT_FOUND',
        message: `未找到教学会话 ${sessionId}。`,
      });
    }
    return session;
  }

  save(session: TeachingAgentSession): void {
    this.sessions.set(session.sessionId, session);
  }

  getEventResult(
    sessionId: string,
    eventId: string,
  ): TeachingAgentTurnResult | undefined {
    const result = this.eventResults.get(this.eventKey(sessionId, eventId));
    return result ? structuredClone(result) : undefined;
  }

  rememberEventResult(
    sessionId: string,
    eventId: string,
    result: TeachingAgentTurnResult,
  ): void {
    this.eventResults.set(
      this.eventKey(sessionId, eventId),
      structuredClone(result),
    );
  }

  private eventKey(sessionId: string, eventId: string): string {
    return `${sessionId}:${eventId}`;
  }
}
