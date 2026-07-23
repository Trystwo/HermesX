import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT 认证守卫
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
