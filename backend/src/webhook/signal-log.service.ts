import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { randomUUID } from 'crypto';
import { SignalLog, SignalDecision } from './signal-log.entity';

export interface SignalResult {
  status?: string;
  message?: string;
  trade?: { id?: string };
}

export function decisionFromResult(result: SignalResult): { decision: SignalDecision; reason: string | null; tradeId: string | null } {
  const status = (result?.status || '').toLowerCase();
  const message = result?.message || null;
  if (status === 'success') {
    return { decision: 'executed', reason: message, tradeId: result?.trade?.id ?? null };
  }
  if (status === 'skipped') {
    if (/new orders paused/i.test(message || '')) return { decision: 'skipped_new_orders_paused', reason: message, tradeId: null };
    if (/single mode/i.test(message || '')) return { decision: 'skipped_single_mode', reason: message, tradeId: null };
    if (/position already open/i.test(message || '')) return { decision: 'skipped_position_open', reason: message, tradeId: null };
    return { decision: 'skipped_paused', reason: message, tradeId: null };
  }
  return { decision: 'error', reason: message, tradeId: null };
}

@Injectable()
export class SignalLogService {
  private readonly logger = new Logger(SignalLogService.name);
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(SignalLog)
    private readonly repo: Repository<SignalLog>,
  ) {}

  record(signal: Record<string, unknown> | null | undefined): string {
    const id = randomUUID();
    try {
      const raw = signal || {};
      const safePayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (k === 'secret') continue;
        safePayload[k] = v;
      }
      const row: Partial<SignalLog> = {
        id,
        strategyId: (raw['strategyId'] as string) ?? null,
        symbol: (raw['symbol'] as string) ?? null,
        action: raw['action'] ? String(raw['action']).toUpperCase() : null,
        payload: safePayload,
        decision: 'error',
      };
      const p = this.repo
        .insert(row as QueryDeepPartialEntity<SignalLog>)
        .then(() => undefined)
        .catch(() => undefined);
      this.pending.set(id, p);
    } catch {
      return id;
    }
    return id;
  }

  decide(id: string, decision: SignalDecision, reason?: string | null, tradeId?: string | null): void {
    if (!id) return;
    const run = () =>
      this.repo
        .update({ id }, { decision, decisionReason: reason ?? null, tradeId: tradeId ?? null })
        .then(() => undefined)
        .catch(() => undefined);
    try {
      const prev = this.pending.get(id);
      const chained = prev ? prev.then(run, run) : run();
      chained.finally(() => this.pending.delete(id));
    } catch {
      return;
    }
  }

  decideFromResult(id: string, result: SignalResult): void {
    const { decision, reason, tradeId } = decisionFromResult(result);
    this.decide(id, decision, reason, tradeId);
  }

  async range(strategyId?: string): Promise<{ first: string | null; last: string | null; count: number; symbols: string[] }> {
    const aggQb = this.repo.createQueryBuilder('s')
      .select('MIN(s.receivedAt)', 'first')
      .addSelect('MAX(s.receivedAt)', 'last')
      .addSelect('COUNT(*)', 'count');
    if (strategyId) aggQb.where('s.strategyId = :strategyId', { strategyId });
    const agg = await aggQb.getRawOne();

    const symQb = this.repo.createQueryBuilder('s').select('DISTINCT s.symbol', 'symbol');
    if (strategyId) symQb.where('s.strategyId = :strategyId AND s.symbol IS NOT NULL', { strategyId });
    else symQb.where('s.symbol IS NOT NULL');
    const symRows = await symQb.getRawMany();

    return {
      first: agg?.first ? new Date(agg.first).toISOString() : null,
      last: agg?.last ? new Date(agg.last).toISOString() : null,
      count: Number(agg?.count) || 0,
      symbols: symRows.map((r) => r.symbol).filter(Boolean),
    };
  }

  async query(params: { strategyId?: string; from?: Date; to?: Date; limit?: number }): Promise<SignalLog[]> {
    const where: Record<string, unknown> = {};
    if (params.strategyId) where.strategyId = params.strategyId;
    if (params.from && params.to) where.receivedAt = Between(params.from, params.to);
    else if (params.from) where.receivedAt = MoreThanOrEqual(params.from);
    else if (params.to) where.receivedAt = LessThanOrEqual(params.to);
    const take = Math.min(Math.max(params.limit || 2000, 1), 2000);
    return this.repo.find({ where, order: { receivedAt: 'DESC' }, take });
  }
}
