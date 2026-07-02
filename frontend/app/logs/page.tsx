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

type LogLevel = 'ALL' | 'INFO' | 'SUCCESS' | 'ERROR';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel>('ALL');
  const [viewMode, setViewMode] = useState<'logs' | 'cards'>('logs');
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

  const getLogLevel = (log: LogEntry): 'INFO' | 'SUCCESS' | 'ERROR' => {
    if (log.status === 'ERROR' || log.error) return 'ERROR';
    if (log.status === 'CLOSED' && log.pnl != null && getPnLValue(log.pnl) > 0) return 'SUCCESS';
    return 'INFO';
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'ALL') return true;
    return getLogLevel(log) === filter;
  });

  const getLevelStyles = (level: 'INFO' | 'SUCCESS' | 'ERROR') => {
    switch (level) {
      case 'ERROR': return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'SUCCESS': return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      default: return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    }
  };

  const formatLogMessage = (log: LogEntry) => {
    const parts = [];

    parts.push(
      <span key="action" className={log.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>
        {log.side === 'BUY' ? 'LONG' : 'SHORT'}
      </span>
    );

    parts.push(
      <span key="symbol" className="text-foreground font-semibold ml-1">{log.symbol}</span>
    );

    parts.push(
      <span key="price" className="text-muted-foreground ml-2 font-mono">@ {formatPrice(log.entryPrice)}</span>
    );

    if (log.exitPrice != null) {
      parts.push(
        <span key="exit" className="text-muted-foreground ml-1 font-mono">&rarr; {formatPrice(log.exitPrice)}</span>
      );
    }

    parts.push(
      <span key="status" className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
        log.status === 'OPEN' ? 'bg-blue-500/15 text-blue-400 border-blue-500/20' :
        log.status === 'CLOSED' ? 'bg-secondary text-muted-foreground border-border/30' :
        'bg-red-500/15 text-red-400 border-red-500/20'
      }`}>
        {log.status}
      </span>
    );

    if (log.closeReason) {
      parts.push(
        <span key="reason" className="text-muted-foreground/60 ml-2 text-[10px]">({log.closeReason})</span>
      );
    }

    if (log.pnl != null && log.status === 'CLOSED') {
      const pnlVal = getPnLValue(log.pnl);
      parts.push(
        <span key="pnl" className={`ml-2 font-semibold font-mono ${pnlVal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {formatPnLSummary(log.pnl)} USDT
        </span>
      );
    }

    if (log.error) {
      parts.push(
        <span key="error" className="text-red-400 ml-2 text-[10px]">Error: {log.error}</span>
      );
    }

    return parts;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">System Logs</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Histórico de todos os trades do sistema</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-all flex items-center gap-1.5 border ${
              autoRefresh
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-secondary text-muted-foreground border-border/40'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-500 pulse-dot' : 'bg-muted-foreground'}`} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
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

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex gap-1">
          {(['ALL', 'INFO', 'SUCCESS', 'ERROR'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setFilter(level)}
              className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                filter === level
                  ? level === 'ERROR' ? 'bg-red-500/15 text-red-400 border border-red-500/30' :
                    level === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                    'bg-primary/15 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              {level === 'ALL' ? 'Todos' : level}
              {level !== 'ALL' && (
                <span className="ml-1 opacity-60">
                  ({logs.filter(l => getLogLevel(l) === level).length})
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setViewMode('logs')}
            className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
              viewMode === 'logs'
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
            }`}
          >
            Logs
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
        </div>
      ) : (
        <div className="bg-card/60 rounded-lg border border-border/60 overflow-hidden">
          <div className="divide-y divide-border/20">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                Sem logs para exibir
              </div>
            ) : (
              filteredLogs.map((log) => {
                const level = getLogLevel(log);
                return (
                  <div
                    key={log.id}
                    className="px-4 py-3 hover:bg-secondary/10 transition-colors flex items-start gap-3"
                  >
                    <div className="text-[10px] text-muted-foreground/60 font-mono w-24 flex-shrink-0">
                      <div>{formatDateUTC(log.timestamp)}</div>
                      <div>{formatTimeUTC(log.timestamp)}</div>
                    </div>

                    <div className="flex-shrink-0">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getLevelStyles(level)}`}>
                        {level}
                      </span>
                    </div>

                    <div className="text-[10px] text-muted-foreground/50 font-mono w-16 flex-shrink-0 truncate" title={log.strategyId}>
                      {log.strategyId?.substring(0, 8)}...
                    </div>

                    <div className="flex-1 text-xs flex items-center flex-wrap gap-0.5">
                      {formatLogMessage(log)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between items-center text-[10px] text-muted-foreground/60">
        <span>Exibindo {filteredLogs.length} de {logs.length} logs</span>
        <span>
          {logs.filter(l => getLogLevel(l) === 'ERROR').length} erros |{' '}
          {logs.filter(l => getLogLevel(l) === 'SUCCESS').length} sucesso |{' '}
          {logs.filter(l => l.status === 'OPEN').length} abertas
        </span>
      </div>
    </div>
  );
}
