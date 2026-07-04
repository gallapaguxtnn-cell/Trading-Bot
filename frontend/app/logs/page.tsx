'use client';

import { useState, useEffect, useCallback } from 'react';
import { TradeCard } from '@/components/trades/TradeCard';
import { formatPrice, formatPnL, formatPnLSummary, formatDateUTC, formatTimeUTC } from '@/lib/formatters';

interface LogEntry {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type?: string;
  entryPrice: number | string;
  exitPrice?: number | string | null;
  quantity: number | string;
  pnl?: number | string | null;
  status: 'OPEN' | 'CLOSED' | 'ERROR';
  closeReason?: string;
  closedAt?: string;
  error?: string;
  strategyId: string;
  timestamp: string;
}

type LogFilter = 'ALL' | 'OPEN' | 'WIN' | 'LOSS' | 'ERROR';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>('ALL');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/trades?limit=100`);
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
        setLastRefresh(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const getPnLValue = (pnl: number | string | null | undefined): number => {
    if (!pnl) return 0;
    return typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  };

  const getTradeFilter = (log: LogEntry): LogFilter => {
    if (log.status === 'ERROR' || log.error) return 'ERROR';
    if (log.status === 'OPEN') return 'OPEN';
    if (log.status === 'CLOSED' && log.pnl != null && getPnLValue(log.pnl) > 0) return 'WIN';
    if (log.status === 'CLOSED' && log.pnl != null && getPnLValue(log.pnl) <= 0) return 'LOSS';
    return 'OPEN';
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'ALL') return true;
    return getTradeFilter(log) === filter;
  });

  const counts = {
    open: logs.filter(l => l.status === 'OPEN').length,
    win: logs.filter(l => l.status === 'CLOSED' && getPnLValue(l.pnl) > 0).length,
    loss: logs.filter(l => l.status === 'CLOSED' && getPnLValue(l.pnl) <= 0).length,
    error: logs.filter(l => l.status === 'ERROR' || l.error).length,
  };

  const totalPnL = logs
    .filter(l => l.status === 'CLOSED' && l.pnl != null)
    .reduce((sum, l) => sum + getPnLValue(l.pnl), 0);

  const formatDuration = (start: string, end?: string | null): string => {
    if (!end) return '-';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 0) return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  };

  const formatCloseReasonPt = (reason?: string): string => {
    if (!reason) return '';
    const map: Record<string, string> = {
      STOP_LOSS: 'Stop Loss',
      TAKE_PROFIT: 'Take Profit',
      TAKE_PROFIT_1: 'TP 1',
      TAKE_PROFIT_2: 'TP 2',
      TAKE_PROFIT_3: 'TP 3',
      TRAILING_STOP: 'Trailing Stop',
      MANUAL: 'Manual',
      SIGNAL: 'Sinal',
      REVERSE_SIGNAL: 'Sinal Reverso',
      ERROR: 'Erro',
      TIMEOUT: 'Timeout',
      MARKET_CLOSE: 'Fechamento',
    };
    return map[reason] || reason.replace(/_/g, ' ');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Trade Logs</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Histórico de trades executados pelo bot</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all flex items-center gap-1.5 border ${
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-secondary text-muted-foreground border-border/40'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500 pulse-dot' : 'bg-muted-foreground'}`} />
            Auto {autoRefresh ? 'ON' : 'OFF'}
          </button>
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground/60 font-mono hidden sm:inline">
              {formatTimeUTC(lastRefresh)} UTC
            </span>
          )}
          <button
            onClick={fetchLogs}
            disabled={isLoading}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              isLoading
                ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                : 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
            }`}
          >
            {isLoading ? 'Carregando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="glass-card rounded-lg p-3">
          <div className="text-[10px] text-muted-foreground mb-1">P&L Total</div>
          <div className={`text-lg font-bold font-mono ${totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
          </div>
          <div className="text-[10px] text-muted-foreground/60">USDT</div>
        </div>
        <div className="glass-card rounded-lg p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Abertas</div>
          <div className="text-lg font-bold font-mono text-blue-400">{counts.open}</div>
          <div className="text-[10px] text-muted-foreground/60">posições</div>
        </div>
        <div className="glass-card rounded-lg p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Wins</div>
          <div className="text-lg font-bold font-mono text-emerald-400">{counts.win}</div>
          <div className="text-[10px] text-muted-foreground/60">trades</div>
        </div>
        <div className="glass-card rounded-lg p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Losses</div>
          <div className="text-lg font-bold font-mono text-red-400">{counts.loss}</div>
          <div className="text-[10px] text-muted-foreground/60">trades</div>
        </div>
        <div className="glass-card rounded-lg p-3">
          <div className="text-[10px] text-muted-foreground mb-1">Win Rate</div>
          <div className="text-lg font-bold font-mono text-foreground">
            {counts.win + counts.loss > 0
              ? ((counts.win / (counts.win + counts.loss)) * 100).toFixed(1)
              : '0.0'}%
          </div>
          <div className="text-[10px] text-muted-foreground/60">{counts.win + counts.loss} fechados</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex gap-1 flex-wrap">
          {([
            { key: 'ALL' as const, label: 'Todos', count: logs.length },
            { key: 'OPEN' as const, label: 'Abertos', count: counts.open, color: 'blue' },
            { key: 'WIN' as const, label: 'Wins', count: counts.win, color: 'emerald' },
            { key: 'LOSS' as const, label: 'Losses', count: counts.loss, color: 'red' },
            { key: 'ERROR' as const, label: 'Erros', count: counts.error, color: 'red' },
          ]).map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                filter === item.key
                  ? item.color === 'emerald' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : item.color === 'red' ? 'bg-red-500/15 text-red-400 border border-red-500/30'
                  : item.color === 'blue' ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                  : 'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              {item.label}
              <span className="ml-1 opacity-60">({item.count})</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('table')}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              viewMode === 'table'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            Tabela
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              viewMode === 'cards'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            Cards
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredLogs.map((log) => (
            <TradeCard key={log.id} trade={log} />
          ))}
          {filteredLogs.length === 0 && (
            <div className="col-span-full p-8 text-center text-muted-foreground text-xs">
              Sem trades para exibir
            </div>
          )}
        </div>
      ) : (
        <div className="glass-card rounded-lg overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px_100px_90px] gap-2 px-4 py-2.5 border-b border-border/40 text-[10px] text-muted-foreground/60 uppercase tracking-wider font-medium">
            <div>Trade</div>
            <div>Lado</div>
            <div className="text-right">Entrada</div>
            <div className="text-right">Saída</div>
            <div className="text-right">P&L</div>
            <div className="text-center">Status</div>
            <div className="text-right">Duração</div>
          </div>

          <div className="divide-y divide-border/20">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                Sem trades para exibir
              </div>
            ) : (
              filteredLogs.map((log) => {
                const pnlVal = getPnLValue(log.pnl);
                const isClosed = log.status === 'CLOSED';
                const isError = log.status === 'ERROR';
                const isWin = isClosed && pnlVal > 0;
                const isLoss = isClosed && pnlVal <= 0;

                const accentClass = isError
                  ? 'border-l-red-500/60'
                  : log.status === 'OPEN'
                  ? 'border-l-blue-500/50'
                  : isWin
                  ? 'border-l-emerald-500/50'
                  : 'border-l-red-500/40';

                return (
                  <div
                    key={log.id}
                    className={`border-l-2 ${accentClass} hover:bg-secondary/10 transition-colors`}
                  >
                    <div className="hidden md:grid grid-cols-[1fr_80px_100px_120px_120px_100px_90px] gap-2 px-4 py-3 items-center">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-sm text-foreground">{log.symbol}</span>
                        <span className="text-[10px] text-muted-foreground/50 font-mono hidden lg:inline">{formatDateUTC(log.timestamp)}</span>
                        <span className="text-[10px] text-muted-foreground/40 font-mono hidden lg:inline">{formatTimeUTC(log.timestamp)}</span>
                      </div>
                      <div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          log.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {log.side === 'BUY' ? 'LONG' : 'SHORT'}
                        </span>
                      </div>
                      <div className="font-mono text-xs text-foreground/80 text-right">{formatPrice(log.entryPrice)}</div>
                      <div className="font-mono text-xs text-foreground/80 text-right">
                        {log.exitPrice != null ? formatPrice(log.exitPrice) : (
                          <span className="text-muted-foreground/40">-</span>
                        )}
                      </div>
                      <div className="text-right">
                        {isClosed && log.pnl != null ? (
                          <span className={`font-mono text-xs font-semibold ${pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatPnLSummary(log.pnl)} USDT
                          </span>
                        ) : isError ? (
                          <span className="text-red-400 text-[10px]">Erro</span>
                        ) : (
                          <span className="text-muted-foreground/40 text-xs">-</span>
                        )}
                      </div>
                      <div className="text-center">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border ${
                          log.status === 'OPEN' ? 'bg-blue-500/15 text-blue-400 border-blue-500/20'
                          : log.status === 'ERROR' ? 'bg-red-500/15 text-red-400 border-red-500/20'
                          : isWin ? 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400/80 border-red-500/20'
                        }`}>
                          {log.status === 'OPEN' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                          {log.status === 'CLOSED' ? formatCloseReasonPt(log.closeReason) || 'Fechado' : log.status === 'ERROR' ? 'Erro' : 'Aberto'}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/60 text-right">
                        {formatDuration(log.timestamp, log.closedAt)}
                      </div>
                    </div>

                    <div className="md:hidden px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-foreground">{log.symbol}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            log.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {log.side === 'BUY' ? 'LONG' : 'SHORT'}
                          </span>
                        </div>
                        {isClosed && log.pnl != null ? (
                          <span className={`font-mono text-sm font-bold ${pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {formatPnLSummary(log.pnl)}
                          </span>
                        ) : (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            log.status === 'OPEN' ? 'bg-blue-500/15 text-blue-400 border-blue-500/20'
                            : 'bg-red-500/15 text-red-400 border-red-500/20'
                          }`}>
                            {log.status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {formatPrice(log.entryPrice)}
                            {log.exitPrice != null && (
                              <span> → {formatPrice(log.exitPrice)}</span>
                            )}
                          </span>
                        </div>
                        <span className="text-muted-foreground/50 font-mono">
                          {formatDateUTC(log.timestamp)} {formatTimeUTC(log.timestamp)}
                        </span>
                      </div>
                      {isClosed && log.closeReason && (
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-muted-foreground/60">{formatCloseReasonPt(log.closeReason)}</span>
                          <span className="text-muted-foreground/50 font-mono">{formatDuration(log.timestamp, log.closedAt)}</span>
                        </div>
                      )}
                      {log.error && (
                        <div className="text-[10px] text-red-400 break-words bg-red-500/10 rounded px-2 py-1">{log.error}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center text-[10px] text-muted-foreground/60">
        <span>Exibindo {filteredLogs.length} de {logs.length} trades</span>
        {lastRefresh && (
          <span className="font-mono">Atualizado: {formatTimeUTC(lastRefresh)} UTC</span>
        )}
      </div>
    </div>
  );
}
