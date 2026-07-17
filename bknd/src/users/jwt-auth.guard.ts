import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  authUser?: { sub: string; email: string };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    if (type !== 'Bearer' || !token) {
      throw this.invalidSession();
    }

    try {
      request.authUser = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
      }>(token);
      return true;
    } catch {
      throw this.invalidSession();
    }
  }

  private invalidSession() {
    return new UnauthorizedException({
      success: false,
      code: 'INVALID_SESSION',
      message: '登录状态已失效，请重新登录。',
    });
  }
}
