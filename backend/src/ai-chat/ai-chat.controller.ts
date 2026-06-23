import { Controller, Post, Body, Get } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';

interface ChatRequestDto {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  strategyId?: string;
  context?: string;
}

@Controller('ai-chat')
export class AiChatController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post()
  async chat(@Body() body: ChatRequestDto) {
    const response = await this.aiChatService.chat(
      body.message,
      body.history || [],
      body.strategyId,
      body.context,
    );
    return { response };
  }

  @Get('status')
  getStatus() {
    return { configured: this.aiChatService.isConfigured() };
  }
}
