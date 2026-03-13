'use client';

import { useEffect, useState } from 'react';

interface TimelineEvent {
  id: string;
  type: string;
  price: number;
  quantity: number;
  pnl: number;
  percentOfPosition: number;
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

  const formatType = (type: string) => {
    return type.replace(/_/g, ' ');
  };

  const getTypeColor = (type: string) => {
    if (type === 'ENTRY') return 'border-blue-500';
    if (type.includes('TAKE_PROFIT')) return 'border-green-500';
    if (type === 'STOP_LOSS') return 'border-red-500';
    return 'border-gray-500';
  };

  return (
    <div className="space-y-3 mt-2">
      {events.map((event, idx) => (
        <div key={event.id} className={`flex items-start gap-3 border-l-2 ${getTypeColor(event.type)} pl-3 py-1`}>
          <div className="flex-shrink-0 w-20">
            <div className="text-xs text-gray-400">
              {new Date(event.executedAt).toLocaleTimeString()}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{formatType(event.type)}</div>
            <div className="text-xs text-gray-300">
              {parseFloat(event.quantity.toString()).toFixed(4)} @ ${parseFloat(event.price.toString()).toFixed(2)}
              {event.percentOfPosition && event.percentOfPosition < 100 && (
                <span className="ml-1 text-gray-400">
                  ({parseFloat(event.percentOfPosition.toString()).toFixed(0)}%)
                </span>
              )}
            </div>
          </div>

          <div className={`flex-shrink-0 font-mono text-sm font-semibold ${
            parseFloat(event.pnl?.toString() || '0') >= 0 ? 'text-green-500' : 'text-red-500'
          }`}>
            {parseFloat(event.pnl?.toString() || '0') >= 0 ? '+' : ''}
            {parseFloat(event.pnl?.toString() || '0').toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}
