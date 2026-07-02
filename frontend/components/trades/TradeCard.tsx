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
  error?: string;
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

  const statusStyles = () => {
    if (trade.status === 'OPEN') return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    if (trade.status === 'ERROR') return 'bg-red-500/15 text-red-400 border-red-500/30';
    if (trade.status === 'CLOSED' && totalPnl >= 0) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (trade.status === 'CLOSED' && totalPnl < 0) return 'bg-red-500/15 text-red-400 border-red-500/30';
    return 'bg-secondary text-muted-foreground border-border/40';
  };

  const getDisplayTimestamp = () => {
    if (trade.status === 'ERROR' && trade.closedAt) return trade.closedAt;
    return trade.timestamp;
  };

  return (
    <div className="bg-card/80 rounded-lg border border-border/60 backdrop-blur-sm hover:border-border transition-all">
      <div className="p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-2">
            <span className="font-bold text-base text-foreground">{trade.symbol}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
              trade.side === 'BUY' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'
            }`}>
              {trade.side === 'BUY' ? 'LONG' : 'SHORT'}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusStyles()}`}>
              {trade.status}
            </span>
          </div>
          <div className={`font-mono text-base font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatPnL(trade.pnl)} USDT
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-0.5">Entry</div>
            <div className="font-mono font-semibold text-foreground">{formatPrice(trade.entryPrice)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-0.5">Exit</div>
            <div className="font-mono font-semibold text-foreground">{formatPrice(trade.exitPrice)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-0.5">Quantidade</div>
            <div className="font-mono text-foreground">{formatQuantity(trade.quantity)}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-0.5">Tipo</div>
            <div className="uppercase text-[11px] text-foreground">{trade.type || 'MARKET'}</div>
          </div>
        </div>

        {trade.error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 text-xs text-red-400 break-words">
            {trade.error}
          </div>
        )}

        {isClosed && trade.closeReason && (
          <div className="border-t border-border/30 pt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Motivo:</span>
              <span className="font-semibold text-foreground">{formatCloseReason(trade.closeReason)}</span>
            </div>
          </div>
        )}

        <div className="border-t border-border/30 pt-2">
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="w-full text-left text-xs text-primary hover:text-primary/80 transition-colors flex items-center justify-between"
          >
            <span className="font-semibold flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showTimeline ? 'rotate-90' : ''}`}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Execution Timeline
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {formatDateUTC(getDisplayTimestamp())} {formatTimeUTC(getDisplayTimestamp())}
            </span>
          </button>

          {showTimeline && (
            <div className="mt-3">
              <TradeTimeline tradeId={trade.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
