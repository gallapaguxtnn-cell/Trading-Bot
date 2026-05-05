'use client';

import { useEffect, useState } from 'react';
import { formatPrice, formatQuantity, formatPnL, formatPercent, formatTimeUTC, formatCloseReason } from '@/lib/formatters';

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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/trades/${tradeId}/executions`);

        if (!response.ok) {
          throw new Error('Failed to fetch executions');
        }

        const data = await response.json();
        setEvents(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    if (tradeId) {
      fetchExecutions();
    }
  }, [tradeId]);

  if (loading) {
    return (
      <div className="text-sm text-gray-400 py-2">
        Loading timeline...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-400 py-2">
        Error: {error}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-400 py-2">
        No executions recorded yet
      </div>
    );
  }

  const getTypeColor = (type: string) => {
    if (type === 'ENTRY') return 'border-blue-500';
    if (type.includes('TAKE_PROFIT')) return 'border-green-500';
    if (type === 'STOP_LOSS') return 'border-red-500';
    return 'border-gray-500';
  };

  const getPnLValue = (pnl: number | string | null): number => {
    if (pnl === null || pnl === undefined) return 0;
    return typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  };

  const getPercentValue = (percent: number | string | null): number => {
    if (percent === null || percent === undefined) return 100;
    return typeof percent === 'string' ? parseFloat(percent) : percent;
  };

  return (
    <div className="space-y-3 mt-2">
      {events.map((event) => (
        <div key={event.id} className={`flex items-start gap-3 border-l-2 ${getTypeColor(event.type)} pl-3 py-1`}>
          <div className="flex-shrink-0 w-24">
            <div className="text-xs text-gray-400">
              {formatTimeUTC(event.executedAt)}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{formatCloseReason(event.type)}</div>
            <div className="text-xs text-gray-300">
              {formatQuantity(event.quantity)} @ {formatPrice(event.price)}
              {event.percentOfPosition !== null && getPercentValue(event.percentOfPosition) < 100 && (
                <span className="ml-1 text-gray-400">
                  ({formatPercent(event.percentOfPosition)})
                </span>
              )}
            </div>
          </div>

          <div className={`flex-shrink-0 font-mono text-sm font-semibold ${
            getPnLValue(event.pnl) >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            {formatPnL(event.pnl)} USDT
          </div>
        </div>
      ))}
    </div>
  );
}
