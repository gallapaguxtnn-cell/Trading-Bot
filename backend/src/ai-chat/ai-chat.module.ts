import { Module } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { AiTokenGuard } from './ai-token.guard';
import { AuditorModule } from '../auditor/auditor.module';

@Module({
  imports: [AuditorModule],
  controllers: [AiChatController],
  providers: [AiChatService, AiTokenGuard],
})
export class AiChatModule {}
