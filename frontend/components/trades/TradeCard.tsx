'use client';

import { useState } from 'react';
import { TradeTimeline } from './TradeTimeline';
import { formatPrice, formatQuantity, formatPnL, formatDateUTC, formatTimeUTC, formatCloseReason } from '@/lib/formatters';

interface Trade {
  id: string;
  symbol: string;
  side: string;
  status: string;
  type?: string;
  entryPrice: number | string;
  exitPrice?: number | string | null;
  quantity: number | string;
  pnl?: number | string | null;
  closeReason?: string;
  timestamp: string;
  closedAt?: string;
}

interface TradeCardProps {
  trade: Trade;
}

export function TradeCard({ trade }: TradeCardProps) {
  const [showTimeline, setShowTimeline] = useState(false);

  const getPnLValue = (): number => {
    if (!trade.pnl) return 0;
    return typeof trade.pnl === 'string' ? parseFloat(trade.pnl) : trade.pnl;
  };

  const totalPnl = getPnLValue();
  const isClosed = trade.status === 'CLOSED';

  const getStatusColor = () => {
    if (trade.status === 'OPEN') return 'bg-blue-900 text-blue-300';
    if (trade.status === 'ERROR') return 'bg-rose-900 text-rose-300';
    if (trade.status === 'CLOSED' && totalPnl >= 0) return 'bg-green-900 text-green-300';
    if (trade.status === 'CLOSED' && totalPnl < 0) return 'bg-red-900 text-red-300';
    return 'bg-gray-900 text-gray-300';
  };

  const getDisplayTimestamp = () => {
    if (trade.status === 'ERROR' && trade.closedAt) {
      return trade.closedAt;
    }
    return trade.timestamp;
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-3 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <span className="font-bold text-lg">{trade.symbol}</span>
          <span className={`px-2 py-1 rounded text-xs font-semibold ${
            trade.side === 'BUY' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}>
            {trade.side}
          </span>
          <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor()}`}>
            {trade.status}
          </span>
        </div>
        <div className={`font-mono text-lg font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          {formatPnL(trade.pnl)} USDT
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-gray-400 text-xs mb-1">Entry Price</div>
          <div className="font-mono font-semibold">{formatPrice(trade.entryPrice)}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">Exit Price</div>
          <div className="font-mono font-semibold">{formatPrice(trade.exitPrice)}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">Quantity</div>
          <div className="font-mono">{formatQuantity(trade.quantity)}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">Type</div>
          <div className="uppercase text-xs">{trade.type || 'MARKET'}</div>
        </div>
      </div>

      {isClosed && trade.closeReason && (
        <div className="border-t border-gray-700 pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">Close Reason:</span>
            <span className="font-semibold text-gray-200">{formatCloseReason(trade.closeReason)}</span>
          </div>
        </div>
      )}

      <div className="border-t border-gray-700 pt-3">
        <button
          onClick={() => setShowTimeline(!showTimeline)}
          className="w-full text-left text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center justify-between"
        >
          <span className="font-semibold">
            {showTimeline ? '▼' : '▶'} Execution Timeline
          </span>
          <span className="text-xs text-gray-400">
            {formatDateUTC(getDisplayTimestamp())} {formatTimeUTC(getDisplayTimestamp())} UTC
          </span>
        </button>

        {showTimeline && (
          <div className="mt-3">
            <TradeTimeline tradeId={trade.id} />
          </div>
        )}
      </div>
    </div>
  );
}
