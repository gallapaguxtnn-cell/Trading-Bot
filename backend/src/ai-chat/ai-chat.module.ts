import { Module } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';
import { AuditorModule } from '../auditor/auditor.module';

@Module({
  imports: [AuditorModule],
  controllers: [AiChatController],
  providers: [AiChatService],
})
export class AiChatModule {}
