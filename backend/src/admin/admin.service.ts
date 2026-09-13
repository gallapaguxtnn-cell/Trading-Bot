import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Trade } from '../strategies/trade.entity';
import { TradeExecution } from '../trades/trade-execution.entity';
import { SignalLog } from '../webhook/signal-log.entity';
import { Strategy, Exchange } from '../strategies/strategy.entity';
import { AuditLog, AuditCategory, AuditSeverity } from '../auditor/audit-log.entity';
import { CredentialsResolverService } from '../common/credentials-resolver.service';
import { BybitClientService } from '../exchange/bybit-client.service';
import { EncryptionUtil } from '../utils/encryption.util';
import { BinanceRequestUtil } from '../utils/binance-request.util';

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
const BINANCE_TESTNET_URL = 'https://testnet.binancefuture.com';
const BINANCE_MAINNET_URL = 'https://fapi.binance.com';

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
    private readonly bybitClient: BybitClientService,
  ) {}

  private async checkBinanceOrderStatus(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    orderId: string,
  ): Promise<string | null> {
    try {
      const baseUrl = isTestnet ? BINANCE_TESTNET_URL : BINANCE_MAINNET_URL;
      const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${Date.now()}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

      const response = await BinanceRequestUtil.get(
        `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey } },
      );

      return response.data?.status ?? null;
    } catch (error: any) {
      this.logger.warn(`[RESET] Falha ao consultar ordem Binance ${orderId} (${symbol}): ${error.message}`);
      return null;
    }
  }

  private async cancelBinanceOrder(
    apiKey: string,
    apiSecret: string,
    isTestnet: boolean,
    symbol: string,
    orderId: string,
  ): Promise<void> {
    const baseUrl = isTestnet ? BINANCE_TESTNET_URL : BINANCE_MAINNET_URL;
    const queryString = `symbol=${symbol}&orderId=${orderId}&timestamp=${Date.now()}`;
    const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

    await BinanceRequestUtil.delete(
      `${baseUrl}/fapi/v1/order?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': apiKey } },
    );
  }

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

      if (credentials.exchange === Exchange.BYBIT) {
        let orderInfo = await this.bybitClient.getOrderInfo(apiKey, apiSecret, credentials.isTestnet, trade.symbol, orderId, credentials.siteId);
        if (!orderInfo) {
          orderInfo = await this.bybitClient.getOrderHistory(apiKey, apiSecret, credentials.isTestnet, trade.symbol, orderId, credentials.siteId);
        }
        const status = orderInfo?.orderStatus;
        if (status && LIVE_BYBIT_STATUSES.has(status)) {
          live.push({ tradeId: trade.id, symbol: trade.symbol, orderId, status, exchange: Exchange.BYBIT });
        }
      } else if (credentials.exchange === Exchange.BINANCE) {
        const status = await this.checkBinanceOrderStatus(apiKey, apiSecret, credentials.isTestnet, trade.symbol, orderId);
        if (status && LIVE_BINANCE_STATUSES.has(status)) {
          live.push({ tradeId: trade.id, symbol: trade.symbol, orderId, status, exchange: Exchange.BINANCE });
        }
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

        if (order.exchange === Exchange.BYBIT) {
          await this.bybitClient.cancelOrder(apiKey, apiSecret, credentials.isTestnet, order.symbol, order.orderId, credentials.siteId);
        } else {
          await this.cancelBinanceOrder(apiKey, apiSecret, credentials.isTestnet, order.symbol, order.orderId);
        }

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
}
