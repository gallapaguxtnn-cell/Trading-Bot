import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditorService } from '../auditor/auditor.service';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are Singularity AI, a trading operations analyst. You have access to audit logs, trade reconciliation data, and backtest comparison results.

Your role:
- Analyze trade execution quality (slippage, latency, fees)
- Explain discrepancies between backtest results and real bot executions
- Identify patterns in errors or underperformance
- Suggest parameter adjustments based on audit data
- Answer questions about specific trades or strategies

Rules:
- Always base answers on provided data, never fabricate numbers
- When discussing P&L, always clarify if gross or net (after fees)
- Flag any suspicious patterns (consistently high slippage, repeated errors)
- Respond in the same language the user writes in
- Be concise and actionable`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private client: Anthropic | null = null;

  constructor(
    private configService: ConfigService,
    private auditorService: AuditorService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  async chat(
    userMessage: string,
    conversationHistory: ChatMessage[],
    strategyId?: string,
    directContext?: string,
  ): Promise<string> {
    if (!this.client) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    let contextData = '';

    if (directContext) {
      contextData = `\n\n--- CONTEXT ---\n${directContext}\n--- END CONTEXT ---\n`;
    } else if (strategyId) {
      try {
        const [summary, recentLogs] = await Promise.all([
          this.auditorService.getAuditSummary(strategyId),
          this.auditorService.getAuditLogs({ strategyId, limit: 20 }),
        ]);

        contextData = `\n\n--- AUDIT CONTEXT (strategy: ${strategyId}) ---\n`;
        contextData += `Total issues: ${summary.total}\n`;
        contextData += `By severity: ${JSON.stringify(summary.bySeverity)}\n`;
        contextData += `By category: ${JSON.stringify(summary.byCategory)}\n`;

        if (recentLogs.length > 0) {
          contextData += `\nRecent audit logs:\n`;
          for (const log of recentLogs.slice(0, 10)) {
            contextData += `- [${log.severity}] ${log.category}: ${log.message}\n`;
          }
        }
        contextData += `--- END CONTEXT ---\n`;
      } catch (err) {
        this.logger.warn(`Could not fetch audit context: ${err}`);
      }
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...conversationHistory.slice(-20),
      { role: 'user', content: userMessage + contextData },
    ];

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? 'No response generated.';
  }

  isConfigured(): boolean {
    return this.client !== null;
  }
}
