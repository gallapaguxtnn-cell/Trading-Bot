import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { SignalLog } from '../webhook/signal-log.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { AuditLog, AuditCategory, AuditSeverity } from '../auditor/audit-log.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { ExchangeClientFactory } from '../exchange/exchange-client.factory';
import { toAccountContext } from '../common/account-context.util';
import { EncryptionUtil } from '../utils/encryption.util';
import { RateLimiterUtil } from '../utils/rate-limiter.util';

const EGRESS_IP_CACHE_KEY = 'admin:egress-ip';
const EGRESS_IP_CACHE_TTL_MS = 10 * 60 * 1000;
const EGRESS_IP_PROVIDERS = ['https://api.ipify.org?format=json', 'https://ifconfig.me/ip'];

export interface ResetTradesParams {
  dryRun?: boolean;
  confirm?: string;
  portfolioId?: string;
  executedBy?: string;
  cancelOrphanOrders?: boolean;
}

export interface LiveOrphanOrder {
  tradeId: string;
  symbol: string;
  orderId: string;
  status: string;
  exchange: Exchange;
}

const LIVE_BYBIT_STATUSES = new Set(['New', 'PartiallyFilled', 'Untriggered']);
const LIVE_BINANCE_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED']);

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectRepository(TradeExecution)
    private readonly executionRepository: Repository<TradeExecution>,
    @InjectRepository(SignalLog)
    private readonly signalLogRepository: Repository<SignalLog>,
    @InjectRepository(Strategy)
    private readonly strategyRepository: Repository<Strategy>,
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
    private readonly credentialsResolver: CredentialsResolverService,
    private readonly exchangeFactory: ExchangeClientFactory,
  ) {}

  private async checkLiveOrders(trades: Trade[]): Promise<LiveOrphanOrder[]> {
    const candidates = trades.filter((t) => t.status !== 'OPEN' && !!t.exchangeOrderId);
    if (!candidates.length) return [];

    const strategyIds = Array.from(new Set(candidates.map((t) => t.strategyId)));
    const strategies = await this.strategyRepository.find({ where: { id: In(strategyIds) } });
    const strategyById = new Map(strategies.map((s) => [s.id, s]));

    const live: LiveOrphanOrder[] = [];

    for (const trade of candidates) {
      const strategy = strategyById.get(trade.strategyId);
      if (!strategy) {
        this.logger.warn(`[RESET] Trade ${trade.id}: estrategia ${trade.strategyId} nao encontrada -- nao foi possivel verificar a ordem ${trade.exchangeOrderId} na corretora`);
        live.push({ tradeId: trade.id, symbol: trade.symbol, orderId: trade.exchangeOrderId!, status: 'UNKNOWN (estrategia nao encontrada)', exchange: Exchange.BINANCE });
        continue;
      }

      const credentials = await this.credentialsResolver.resolveCredentials(strategy);
      if (!credentials.apiKey || !credentials.apiSecret) {
        this.logger.warn(`[RESET] Trade ${trade.id}: sem credenciais resolvidas -- nao foi possivel verificar a ordem ${trade.exchangeOrderId} na corretora`);
        live.push({ tradeId: trade.id, symbol: trade.symbol, orderId: trade.exchangeOrderId!, status: 'UNKNOWN (sem credenciais)', exchange: credentials.exchange });
        continue;
      }

      const apiKey = (await EncryptionUtil.decrypt(credentials.apiKey)).trim();
      const apiSecret = (await EncryptionUtil.decrypt(credentials.apiSecret)).trim();
      const orderId = trade.exchangeOrderId!;
      const client = this.exchangeFactory.get(credentials.exchange);
      const ctx = toAccountContext(credentials, apiKey, apiSecret);

      let orderInfo = await client.getOrderInfo(ctx, trade.symbol, orderId);
      if (!orderInfo) {
        orderInfo = await client.getOrderHistory(ctx, trade.symbol, orderId);
      }
      const status = orderInfo?.orderStatus;
      const liveStatuses = credentials.exchange === Exchange.BINANCE ? LIVE_BINANCE_STATUSES : LIVE_BYBIT_STATUSES;
      if (status && liveStatuses.has(status)) {
        live.push({ tradeId: trade.id, symbol: trade.symbol, orderId, status, exchange: credentials.exchange });
      }
    }

    return live;
  }

  private async cancelLiveOrders(liveOrders: LiveOrphanOrder[], trades: Trade[]): Promise<LiveOrphanOrder[]> {
    if (!liveOrders.length) return [];

    const tradeById = new Map(trades.map((t) => [t.id, t]));
    const strategyIds = Array.from(new Set(liveOrders.map((o) => tradeById.get(o.tradeId)?.strategyId).filter(Boolean))) as string[];
    const strategies = await this.strategyRepository.find({ where: { id: In(strategyIds) } });
    const strategyById = new Map(strategies.map((s) => [s.id, s]));

    const cancelled: LiveOrphanOrder[] = [];

    for (const order of liveOrders) {
      const trade = tradeById.get(order.tradeId);
      const strategy = trade ? strategyById.get(trade.strategyId) : undefined;
      if (!strategy) {
        this.logger.error(`[RESET] Nao foi possivel cancelar a ordem orfa ${order.orderId} (${order.symbol}) do trade ${order.tradeId}: estrategia nao encontrada`);
        continue;
      }

      try {
        const credentials = await this.credentialsResolver.resolveCredentials(strategy);
        const apiKey = (await EncryptionUtil.decrypt(credentials.apiKey)).trim();
        const apiSecret = (await EncryptionUtil.decrypt(credentials.apiSecret)).trim();
        const client = this.exchangeFactory.get(order.exchange);
        const ctx = toAccountContext(credentials, apiKey, apiSecret);

        await client.cancelOrder(ctx, order.symbol, order.orderId);

        this.logger.warn(`[RESET] Ordem orfa cancelada: trade=${order.tradeId} symbol=${order.symbol} orderId=${order.orderId} status=${order.status} exchange=${order.exchange}`);
        cancelled.push(order);
      } catch (error: any) {
        this.logger.error(`[RESET] Falha ao cancelar a ordem orfa ${order.orderId} (${order.symbol}) do trade ${order.tradeId}: ${error.message}`);
      }
    }

    return cancelled;
  }

  async resetTrades(params: ResetTradesParams) {
    const dryRun = params.dryRun !== false;
    const tradeWhere: any = {};
    if (params.portfolioId) tradeWhere.portfolioId = params.portfolioId;

    const trades = await this.tradeRepository.find({ where: tradeWhere });
    const openTrades = trades.filter((t) => t.status === 'OPEN');

    const countsByStatus: Record<string, number> = {};
    for (const trade of trades) {
      countsByStatus[trade.status] = (countsByStatus[trade.status] || 0) + 1;
    }

    const timestamps = trades.map((t) => new Date(t.timestamp).getTime()).filter((t) => !isNaN(t));
    const periodCovered = {
      from: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
      to: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    };
    const accumulatedPnl = trades.reduce((sum, t) => sum + (parseFloat(t.pnl as any) || 0), 0);

    const tradeIds = trades.map((t) => t.id);
    const executionsCount = tradeIds.length
      ? await this.executionRepository.count({ where: { tradeId: In(tradeIds) } })
      : 0;

    let strategyIds: string[] = [];
    if (params.portfolioId) {
      const strategies = await this.strategyRepository.find({ where: { portfolioId: params.portfolioId } as any, select: ['id'] });
      strategyIds = strategies.map((s) => s.id);
    }
    const signalLogsCount = params.portfolioId
      ? strategyIds.length
        ? await this.signalLogRepository.count({ where: { strategyId: In(strategyIds) } })
        : 0
      : await this.signalLogRepository.count();

    if (dryRun) {
      const liveOrders = await this.checkLiveOrders(trades);
      return {
        dryRun: true,
        countsByStatus,
        periodCovered,
        accumulatedPnl,
        tradesCount: trades.length,
        executionsCount,
        signalLogsCount,
        openTradesBlocking: openTrades.length,
        liveOrders,
      };
    }

    if (params.confirm !== 'RESET') {
      throw new BadRequestException('Envie confirm: "RESET" no corpo para executar o reset real.');
    }

    if (openTrades.length > 0) {
      throw new ConflictException(
        `Recusado: existe(m) ${openTrades.length} trade(s) OPEN. Feche as posições na corretora ou aguarde antes de resetar.`,
      );
    }

    const liveOrders = await this.checkLiveOrders(trades);
    let cancelledOrphanOrders: LiveOrphanOrder[] = [];

    if (liveOrders.length > 0) {
      if (!params.cancelOrphanOrders) {
        throw new ConflictException(
          `Recusado: existe(m) ${liveOrders.length} ordem(ns) viva(s) na corretora associada(s) a trades que seriam apagados: ` +
          liveOrders.map((o) => `${o.symbol} orderId=${o.orderId} status=${o.status}`).join('; ') +
          `. Use cancelOrphanOrders=true para cancelar essas ordens antes de apagar, ou aguarde a corretora resolve-las.`,
        );
      }
      cancelledOrphanOrders = await this.cancelLiveOrders(liveOrders, trades);
    }

    const backupDir = path.join(process.cwd(), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const executions = tradeIds.length
      ? await this.executionRepository.find({ where: { tradeId: In(tradeIds) } })
      : [];
    const signalLogs = params.portfolioId
      ? strategyIds.length
        ? await this.signalLogRepository.find({ where: { strategyId: In(strategyIds) } })
        : []
      : await this.signalLogRepository.find();

    const backupFileName = `reset-${Date.now()}.json`;
    const backupFilePath = path.join(backupDir, backupFileName);
    fs.writeFileSync(
      backupFilePath,
      JSON.stringify({ exportedAt: new Date().toISOString(), portfolioId: params.portfolioId ?? null, trades, executions, signalLogs }, null, 2),
    );

    if (tradeIds.length) {
      await this.executionRepository.delete({ tradeId: In(tradeIds) });
    }
    if (params.portfolioId) {
      if (strategyIds.length) {
        await this.signalLogRepository.delete({ strategyId: In(strategyIds) });
      }
    } else {
      await this.signalLogRepository.clear();
    }
    if (tradeIds.length) {
      await this.tradeRepository.delete({ id: In(tradeIds) });
    }

    await this.auditRepository.save(
      this.auditRepository.create({
        category: AuditCategory.ADMIN_RESET,
        severity: AuditSeverity.INFO,
        message: `Reset manual de dados de teste executado por ${params.executedBy || 'desconhecido'}: ${tradeIds.length} trade(s), ${executions.length} execucao(oes), ${signalLogs.length} signal log(s) removidos.`,
        details: {
          portfolioId: params.portfolioId ?? null,
          executedBy: params.executedBy ?? null,
          deletedTrades: tradeIds.length,
          deletedExecutions: executions.length,
          deletedSignalLogs: signalLogs.length,
          backupFile: backupFilePath,
          cancelledOrphanOrders,
        },
      }),
    );

    this.logger.warn(
      `[RESET] ${tradeIds.length} trade(s), ${executions.length} execucao(oes), ${signalLogs.length} signal log(s) removidos por ${params.executedBy || 'desconhecido'}. ` +
      `${cancelledOrphanOrders.length} ordem(ns) orfa(s) cancelada(s). Backup: ${backupFilePath}`,
    );

    return {
      dryRun: false,
      success: true,
      deletedTrades: tradeIds.length,
      deletedExecutions: executions.length,
      deletedSignalLogs: signalLogs.length,
      cancelledOrphanOrders,
      backupFile: backupFilePath,
    };
  }

  async getEgressIp(): Promise<{ ip: string; cached: boolean }> {
    const cached = RateLimiterUtil.getInstance().getCached<string>(EGRESS_IP_CACHE_KEY);
    if (cached) {
      return { ip: cached, cached: true };
    }

    let lastError: any = null;
    for (const provider of EGRESS_IP_PROVIDERS) {
      try {
        const response = await axios.get(provider, { timeout: 5000 });
        const ip = this.parseEgressIpResponse(response.data);
        if (!ip) continue;
        RateLimiterUtil.getInstance().setCached(EGRESS_IP_CACHE_KEY, ip, EGRESS_IP_CACHE_TTL_MS);
        return { ip, cached: false };
      } catch (error: any) {
        lastError = error;
      }
    }

    this.logger.error(`[EGRESS IP] Falha ao consultar o IP de saida: ${lastError?.message}`);
    throw new BadRequestException('Nao foi possivel determinar o IP de saida do servidor. Tente novamente em instantes.');
  }

  private parseEgressIpResponse(data: unknown): string | null {
    if (typeof data === 'string') {
      const trimmed = data.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (data && typeof data === 'object' && 'ip' in data) {
      const ip = (data as { ip?: unknown }).ip;
      return typeof ip === 'string' && ip.trim().length > 0 ? ip.trim() : null;
    }
    return null;
  }
}
