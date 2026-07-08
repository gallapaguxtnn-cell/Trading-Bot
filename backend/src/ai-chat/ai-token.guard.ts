import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class AiTokenGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.configService.get<string>('AI_CHAT_TOKEN');
    if (!token) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['x-ai-token'];
    if (header === token) return true;
    throw new HttpException({ error: 'ai_forbidden' }, HttpStatus.UNAUTHORIZED);
  }
}
