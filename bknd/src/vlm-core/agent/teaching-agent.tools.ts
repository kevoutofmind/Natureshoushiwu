import { Injectable } from '@nestjs/common';
import type {
  TeachingAgentCommand,
  TeachingAgentToolName,
} from '../contracts/teaching-agent.types';

@Injectable()
export class TeachingAgentTools {
  private commandSequence = 0;

  command(
    sessionId: string,
    tool: TeachingAgentToolName,
    args: Record<string, unknown> = {},
    options: { requiresAck?: boolean; blocking?: boolean } = {},
  ): TeachingAgentCommand {
    this.commandSequence += 1;
    return {
      commandId: `${sessionId}-cmd-${this.commandSequence}`,
      tool,
      arguments: args,
      requiresAck: options.requiresAck ?? false,
      blocking: options.blocking ?? false,
    };
  }
}
