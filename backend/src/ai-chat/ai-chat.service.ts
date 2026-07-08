import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditorService } from '../auditor/auditor.service';
import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT_AUDITOR = `Você é Singularity AI, analista de operações de trading. Você recebe logs de auditoria, reconciliação de trades com a exchange e comparações backtest × execução real.

Seu papel: analisar qualidade de execução (slippage, latência, taxas), explicar discrepâncias entre backtest e execução real, identificar padrões de erro e sugerir ajustes de parâmetros.

Regras: baseie-se somente nos dados fornecidos, nunca invente números; ao falar de P&L, diga sempre se é bruto ou líquido de taxas; sinalize padrões suspeitos; explique cada issue em linguagem simples para um cliente não técnico, dizendo o que significa e o que fazer; responda no idioma do usuário; seja conciso e acionável.`;

const SYSTEM_PROMPT_ANALYST = `Você é Singularity AI, especialista em mercado financeiro, criptomoedas, trading, análise técnica, derivativos (futuros), spot e nas corretoras Binance, Bybit e OKX. Você conhece este sistema: um backtester que roda no navegador (client-side) com otimizadores DYNAMIC (prioriza menor drawdown), EXTREME (prioriza maior lucro) e ULTIMATE (multi-ativo), auditor com validação matemática e comparação com TradingView e com o bot real, e um bot que recebe webhooks do TradingView e executa em Binance/Bybit.

Erros comuns do sistema: símbolo inexistente na exchange/mercado selecionado, exchange fora do ar, otimizações muito grandes pesadas para a máquina, backend indisponível (auditor e IA fora do ar).

Você domina: análise técnica avançada, backtesting quantitativo com matemática precisa, PineScript do TradingView (lê, interpreta e converte em parâmetros executáveis), risk management e estratégias DCA, grid, scalping, swing, tendência e reversão.

REGRAS ABSOLUTAS: preços com até 5 casas decimais em ativos de baixo valor; cálculos exatos; quando o usuário pedir backtest/estratégia, responda em DOIS blocos: (a) explicação objetiva em português, (b) bloco JSON delimitado por \`\`\`backtest_config ... \`\`\` com esta estrutura:

{
  "symbol": "DOGEUSDT",
  "strategy": {
    "type": "ema_cross" | "sma_cross" | "rsi",
    "params": { "fast": 5, "slow": 200 },
    "direction": "both",
    "entrySize": "pct_balance",
    "entryValue": 10,
    "tps": [{ "pct": 1, "size": 100 }],
    "sl": { "pct": 1 }
  },
  "initialBalance": 1000,
  "timeframe": "1h",
  "overlays": [{ "type": "ema", "period": 5, "color": "#a855f7", "label": "EMA 5" }]
}

O campo "symbol" DEVE ser o ativo que o usuário mencionou na conversa, sempre no formato USDT. Não use o ativo do gráfico se o usuário pediu outro.`;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 2048;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAttachment {
  media_type: string;
  data_base64: string;
  name?: string;
}

export interface ChatParams {
  message: string;
  history?: ChatMessage[];
  mode?: 'auditor' | 'analyst';
  strategyId?: string;
  context?: string;
  attachments?: ChatAttachment[];
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private client: Anthropic | null = null;
  private clientKey: string | null = null;

  constructor(
    private configService: ConfigService,
    private auditorService: AuditorService,
  ) {}

  private getClient(): Anthropic | null {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      this.client = null;
      this.clientKey = null;
      return null;
    }
    if (!this.client || this.clientKey !== apiKey) {
      this.client = new Anthropic({ apiKey, timeout: 60000 });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  private getModel(): string {
    return this.configService.get<string>('ANTHROPIC_MODEL') || DEFAULT_MODEL;
  }

  private getMaxTokens(): number {
    const raw = this.configService.get<string>('ANTHROPIC_MAX_TOKENS');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOKENS;
  }

  isConfigured(): boolean {
    return !!this.configService.get<string>('ANTHROPIC_API_KEY');
  }

  getStatusInfo() {
    return {
      configured: this.isConfigured(),
      model: this.getModel(),
      protected: !!this.configService.get<string>('AI_CHAT_TOKEN'),
    };
  }

  async chat(params: ChatParams): Promise<string> {
    const client = this.getClient();
    if (!client) {
      throw new HttpException(
        { error: 'ai_not_configured', message: 'IA desativada: defina ANTHROPIC_API_KEY no backend e reinicie o serviço' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const { message, history = [], strategyId, context, attachments = [] } = params;
    const mode = params.mode || (context || strategyId ? 'auditor' : 'analyst');
    const system = mode === 'auditor' ? SYSTEM_PROMPT_AUDITOR : SYSTEM_PROMPT_ANALYST;

    const attachmentBlocks = this.buildAttachmentBlocks(attachments);
    const contextData = await this.buildContext(strategyId, context);
    const text = message + contextData;

    const content: string | Anthropic.Messages.ContentBlockParam[] = attachmentBlocks.length
      ? [...attachmentBlocks, { type: 'text', text }]
      : text;

    const messages: Anthropic.Messages.MessageParam[] = [
      ...history.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content },
    ];

    try {
      const response = await client.messages.create({
        model: this.getModel(),
        max_tokens: this.getMaxTokens(),
        system,
        messages,
      });
      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.text ?? 'Sem resposta gerada.';
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private async buildContext(strategyId?: string, directContext?: string): Promise<string> {
    if (directContext) {
      return `\n\n--- CONTEXT ---\n${directContext}\n--- END CONTEXT ---\n`;
    }
    if (!strategyId) return '';
    try {
      const [summary, recentLogs] = await Promise.all([
        this.auditorService.getAuditSummary(strategyId),
        this.auditorService.getAuditLogs({ strategyId, limit: 20 }),
      ]);

      let contextData = `\n\n--- AUDIT CONTEXT (strategy: ${strategyId}) ---\n`;
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
      return contextData;
    } catch (err) {
      this.logger.warn(`Could not fetch audit context: ${err}`);
      return '';
    }
  }

  private buildAttachmentBlocks(attachments: ChatAttachment[]): Anthropic.Messages.ContentBlockParam[] {
    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const att of attachments) {
      const mediaType = att?.media_type || '';
      const data = att?.data_base64 || '';
      if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
        throw new HttpException(
          { error: 'ai_invalid_attachment', message: `Tipo de anexo não suportado: ${mediaType || 'desconhecido'}. Use PNG, JPEG, WEBP, GIF ou PDF.` },
          HttpStatus.BAD_REQUEST,
        );
      }
      const approxBytes = Math.floor(data.length * 0.75);
      if (approxBytes > MAX_ATTACHMENT_BYTES) {
        throw new HttpException(
          { error: 'ai_attachment_too_large', message: `Anexo ${att.name || ''} excede 5MB.`.trim() },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (mediaType === 'application/pdf') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        });
      } else {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
            data,
          },
        });
      }
    }
    return blocks;
  }

  private mapError(err: unknown): HttpException {
    if (err instanceof HttpException) return err;
    if (err instanceof Anthropic.APIError) {
      const status = err.status;
      if (status === 401 || status === 403) {
        return new HttpException(
          { error: 'ai_unauthorized', message: 'Chave de API inválida ou revogada' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (status === 429 || status === 529) {
        return new HttpException(
          { error: 'ai_rate_limited', message: 'Limite de uso da IA atingido, tente novamente em instantes' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }
    this.logger.error(`AI request failed: ${err instanceof Error ? err.message : String(err)}`);
    return new HttpException(
      { error: 'ai_error', message: 'Falha ao consultar a IA' },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
