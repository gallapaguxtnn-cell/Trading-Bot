'use client';

import { useEffect, useState } from 'react';
import { formatPrice, formatQuantity, formatPnL, formatPercent, formatTimeUTC, formatDateTimeUTC, formatCloseReason } from '@/lib/formatters';

interface TimelineEvent {
  id: string;
  type: string;
  price: number | string;
  quantity: number | string;
  pnl: number | string | null;
  percentOfPosition: number | string | null;
  executedAt: string;
  exchangeOrderId?: string;
}

interface TradeTimelineProps {
  tradeId: string;
}

export function TradeTimeline({ tradeId }: TradeTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        setLoading(true);
        setError(null);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        const url = `${apiUrl}/api/trades/${tradeId}/executions`;
        const response = await fetch(url);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText || 'Failed to fetch executions'}`);
        }

        const data = await response.json();
        setEvents(Array.isArray(data) ? data : []);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        console.error('[TradeTimeline] Error:', errorMessage);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    if (tradeId) fetchExecutions();
  }, [tradeId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        Carregando timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 space-y-1">
        <div className="text-xs font-semibold text-red-400">Falha ao carregar execuções</div>
        <div className="text-[10px] text-red-300 font-mono break-words">{error}</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="bg-secondary/30 rounded-md p-3 text-center">
        <div className="text-xs text-muted-foreground">Sem histórico de execução</div>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          Execuções aparecem quando TPs são atingidos ou o trade é fechado
        </div>
      </div>
    );
  }

  const getTypeColor = (type: string) => {
    if (type === 'ENTRY') return 'border-l-blue-500 bg-blue-500';
    if (type.includes('TAKE_PROFIT')) return 'border-l-emerald-500 bg-emerald-500';
    if (type === 'STOP_LOSS') return 'border-l-red-500 bg-red-500';
    if (type === 'MANUAL_CLOSE') return 'border-l-yellow-500 bg-yellow-500';
    if (type === 'SIGNAL_CLOSE') return 'border-l-purple-500 bg-purple-500';
    return 'border-l-muted-foreground bg-muted-foreground';
  };

  const getPnLValue = (pnl: number | string | null): number => {
    if (pnl === null || pnl === undefined) return 0;
    return typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  };

  const getPercentValue = (percent: number | string | null): number => {
    if (percent === null || percent === undefined) return 100;
    return typeof percent === 'string' ? parseFloat(percent) : percent;
  };

  const firstTime = events.length > 0 ? new Date(events[0].executedAt).getTime() : 0;

  return (
    <div className="space-y-0 mt-1">
      {events.map((event, idx) => {
        const color = getTypeColor(event.type);
        const dotColor = color.split(' ')[1];
        const latencyMs = idx > 0 ? new Date(event.executedAt).getTime() - new Date(events[idx - 1].executedAt).getTime() : 0;

        return (
          <div key={event.id} className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center flex-shrink-0 w-5">
              <div className={`w-2.5 h-2.5 rounded-full ${dotColor} ring-2 ring-background mt-1`} />
              {idx < events.length - 1 && <div className="w-px h-full bg-border/40 min-h-[28px]" />}
            </div>

            <div className="flex-1 pb-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{formatCloseReason(event.type)}</span>
                <span className={`font-mono text-xs font-semibold ${
                  event.type === 'ENTRY' ? 'text-muted-foreground' :
                  getPnLValue(event.pnl) >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {event.type === 'ENTRY' ? '' : `${formatPnL(event.pnl)} USDT`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                <span className="font-mono">{formatQuantity(event.quantity)} @ {formatPrice(event.price)}</span>
                {event.percentOfPosition !== null && getPercentValue(event.percentOfPosition) < 100 && (
                  <span className="text-accent">({formatPercent(event.percentOfPosition)})</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-0.5">
                <span className="font-mono">{formatDateTimeUTC(event.executedAt)}</span>
                {idx > 0 && latencyMs > 0 && (
                  <span className={`font-mono ${latencyMs > 5000 ? 'text-yellow-400' : ''}`}>
                    +{latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {event.exchangeOrderId && (
                  <span className="font-mono truncate max-w-[100px]" title={event.exchangeOrderId}>
                    ID: {event.exchangeOrderId.slice(0, 8)}...
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
