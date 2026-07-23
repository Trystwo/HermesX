import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  username: string;
}

export interface AuthResult {
  accessToken: string;
  user: {
    id: string;
    username: string;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (existing) {
      throw new UnauthorizedException('用户名已存在');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
      },
    });

    this.logger.log(`User registered: ${user.username}`);
    return this.signToken(user.id, user.username);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.logger.log(`User logged in: ${user.username}`);
    return this.signToken(user.id, user.username);
  }

  private signToken(userId: string, username: string): AuthResult {
    const payload: JwtPayload = { sub: userId, username };
    const expiresIn = this.configService.get<string>('jwt.expiresIn') || '7d';
    const accessToken = this.jwtService.sign(payload, { expiresIn });
    return {
      accessToken,
      user: { id: userId, username },
    };
  }

  async validateUser(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在或 token 无效');
    }
    return { id: user.id, username: user.username };
  }
}
