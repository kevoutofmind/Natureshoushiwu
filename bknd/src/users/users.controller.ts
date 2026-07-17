import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('用户认证')
@Controller('api/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: '使用电子邮箱和密码注册账号' })
  @ApiCreatedResponse({
    description: '注册成功，同时返回 JWT 和用户信息。',
    schema: {
      example: {
        success: true,
        code: 'REGISTERED',
        message: '注册成功，欢迎加入！',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIs...',
          user: {
            id: '7bf2a742-31a8-4e5e-a32a-12db587f120e',
            email: 'dancer@example.com',
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: '邮箱或密码格式不合法。' })
  @ApiConflictResponse({ description: '电子邮箱已经注册。' })
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.usersService.signup(dto);
  }

  @ApiOperation({ summary: '使用电子邮箱和密码登录' })
  @ApiOkResponse({
    description: '登录成功，返回 JWT 和用户信息。',
  })
  @ApiBadRequestResponse({ description: '邮箱或密码格式不合法。' })
  @ApiNotFoundResponse({ description: '电子邮箱尚未注册。' })
  @ApiUnauthorizedResponse({ description: '密码错误。' })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.usersService.login(dto);
  }

  @ApiOperation({ summary: '获取当前登录用户信息' })
  @ApiBearerAuth('jwt')
  @ApiOkResponse({ description: 'JWT 有效，返回当前用户信息。' })
  @ApiUnauthorizedResponse({ description: 'JWT 缺失、无效或已经过期。' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() request: AuthenticatedRequest) {
    const user = await this.usersService.getPublicUser(request.authUser!.sub);

    return {
      success: true,
      code: 'AUTHENTICATED',
      message: '登录状态有效。',
      data: { user },
    };
  }
}
