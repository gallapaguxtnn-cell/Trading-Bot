import { Body, Controller, Get, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AiChatService } from './ai-chat.service';
import { AiTokenGuard } from './ai-token.guard';

interface ChatRequestDto {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  strategyId?: string;
  context?: string;
  mode?: 'auditor' | 'analyst';
  attachments?: Array<{ media_type: string; data_base64: string; name?: string }>;
}

@Controller('ai-chat')
@UseGuards(AiTokenGuard)
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async chat(@Body() body: ChatRequestDto) {
    if (!body?.message || !String(body.message).trim()) {
      throw new HttpException(
        { error: 'ai_empty_message', message: 'Mensagem vazia' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const response = await this.aiChatService.chat({
      message: body.message,
      history: body.history,
      mode: body.mode,
      strategyId: body.strategyId,
      context: body.context,
      attachments: body.attachments,
    });
    return { response };
  }

  @Get('status')
  getStatus() {
    return this.aiChatService.getStatusInfo();
  }
}
