'use client';

import { useState, useEffect } from 'react';
import { StatsCard } from '@/components/dashboard/StatsCard';
import { Table } from '@/components/ui/Table';

// Define Interface for Stats
interface DashboardStats {
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  activePositions: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  recentSignals: any[];
}

export default function Home() {
  const [stats, setStats] = useState<DashboardStats>({
    totalPnL: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    activePositions: 0,
    winRate: 0,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    recentSignals: []
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/trades/stats`);
        if (res.ok) {
            const data = await res.json();
            setStats(data);
        }
      } catch (e) {
        console.error("Failed to load dashboard stats", e);
      }
    }
    loadStats();
    // Refresh every 10 seconds for "Real Time" feel
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const totalPnl = parseFloat(stats.totalPnL as any) || 0;
  const realizedPnl = parseFloat(stats.realizedPnL as any) || 0;
  const unrealizedPnl = parseFloat(stats.unrealizedPnL as any) || 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-white">Dashboard</h2>
        <div className="text-sm text-slate-400">Auto-refresh every 10s</div>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
            title="Total P&L"
            value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
            subValue="Realized + Unrealized"
            subColor="text-slate-400"
            valueColor={totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatsCard
            title="Win Rate"
            value={`${stats.winRate.toFixed(1)}%`}
            subValue={`${stats.wins}W / ${stats.losses}L`}
            subColor="text-slate-400"
            valueColor={stats.winRate >= 50 ? "text-emerald-400" : "text-amber-400"}
        />
        <StatsCard
            title="Realized P&L"
            value={`${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}`}
            subValue={`${stats.totalTrades} closed trades`}
            subColor="text-slate-400"
            valueColor={realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
        <StatsCard
            title="Unrealized P&L"
            value={`${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`}
            subValue={`${stats.activePositions} open positions`}
            subColor="text-slate-400"
            valueColor={unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-xl font-semibold mb-4 text-white">Recent Trades</h3>
        <Table
            data={stats.recentSignals}
            columns={[
                {
                    header: 'Date',
                    accessor: (item) => {
                        const date = new Date(item.timestamp);
                        return (
                            <div className="text-sm">
                                <div className="text-white">{date.toLocaleDateString()}</div>
                                <div className="text-slate-500 text-xs">{date.toLocaleTimeString()}</div>
                            </div>
                        );
                    }
                },
                {
                    header: 'Symbol',
                    accessor: (item) => (
                        <span className="text-white font-semibold">{item.symbol}</span>
                    )
                },
                {
                    header: 'Side',
                    accessor: (item) => (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            item.side === 'BUY'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-rose-500/20 text-rose-400'
                        }`}>
                            {item.side}
                        </span>
                    )
                },
                {
                    header: 'Entry Price',
                    accessor: (item) => (
                        <span className="text-slate-300">${item.entryPrice?.toFixed(2) || '0.00'}</span>
                    )
                },
                {
                    header: 'Quantity',
                    accessor: (item) => (
                        <span className="text-slate-300">{item.quantity?.toFixed(4) || '0.0000'}</span>
                    )
                },
                {
                    header: 'P&L',
                    accessor: (item) => {
                        const val = item.pnl;
                        if (val === null || val === undefined) {
                            return <span className="text-slate-500">-</span>;
                        }
                        return (
                            <span className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {val > 0 ? '+' : ''}${val.toFixed(2)}
                            </span>
                        );
                    }
                },
                {
                    header: 'Status',
                    accessor: (item) => (
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            item.status === 'SIMULATED' ? 'bg-yellow-500/20 text-yellow-400' :
                            item.status === 'OPEN' ? 'bg-blue-500/20 text-blue-400' :
                            item.status === 'CLOSED' ? 'bg-slate-500/20 text-slate-300' :
                            'bg-red-500/20 text-red-400'
                        }`}>
                            {item.status}
                        </span>
                    )
                },
            ]}
        />
      </div>
    </div>
  );
}
