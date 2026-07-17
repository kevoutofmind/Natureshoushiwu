import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { PublicUser, UserRecord } from './user.types';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existingUser = await this.usersRepository.findByEmail(dto.email);

    if (existingUser) {
      throw this.emailAlreadyExists();
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    let user: UserRecord;

    try {
      user = await this.usersRepository.create(dto.email, passwordHash);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === '23505'
      ) {
        throw this.emailAlreadyExists();
      }

      throw error;
    }

    return this.authResponse('REGISTERED', '注册成功，欢迎加入！', user);
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepository.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException({
        success: false,
        code: 'EMAIL_NOT_FOUND',
        message: '该电子邮箱尚未注册。',
        fieldErrors: { email: '找不到使用该电子邮箱的账号。' },
      });
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_PASSWORD',
        message: '密码错误，请重新输入。',
        fieldErrors: { password: '密码错误。' },
      });
    }

    return this.authResponse('AUTHENTICATED', '登录成功。', user);
  }

  async getPublicUser(id: string): Promise<PublicUser> {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new UnauthorizedException({
        success: false,
        code: 'INVALID_SESSION',
        message: '登录状态已失效，请重新登录。',
      });
    }

    return this.toPublicUser(user);
  }

  private authResponse(code: string, message: string, user: UserRecord) {
    const publicUser = this.toPublicUser(user);
    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      success: true,
      code,
      message,
      data: {
        accessToken,
        user: publicUser,
      },
    };
  }

  private emailAlreadyExists() {
    return new ConflictException({
      success: false,
      code: 'EMAIL_ALREADY_EXISTS',
      message: '该电子邮箱已注册，请直接登录。',
      fieldErrors: { email: '该电子邮箱已注册。' },
    });
  }

  private toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
