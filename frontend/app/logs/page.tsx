'use client';

import { useState, useEffect } from 'react';
import { Table } from '@/components/ui/Table';

export default function LogsPage() {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    // Re-using the trades endpoint for now as it contains the history
    // In a future update, we can have a dedicated "System Logs" table
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/trades`)
      .then(res => res.json())
      .then(data => setLogs(data))
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold text-white">System Logs & Trade History</h2>
      
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <Table 
            data={logs}
            columns={[
                { header: 'Time', accessor: (item) => new Date(item.timestamp).toLocaleString(), className: 'text-sm text-slate-400' },
                { header: 'Level', accessor: () => <span className="text-blue-400 font-mono">INFO</span> },
                { header: 'Source', accessor: 'strategyId', className: 'font-mono text-xs text-slate-500' },
                { 
                    header: 'Message', 
                    accessor: (item) => (
                        <span>
                            <span className={item.side === 'BUY' ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {item.side} {item.symbol}
                            </span>
                            <span className="text-slate-300 ml-2">
                                @ {item.entryPrice} ({item.status})
                                {item.error && <span className="text-rose-500 ml-2">Error: {item.error}</span>}
                            </span>
                        </span>
                    ) 
                },
            ]}
        />
      </div>
    </div>
  );
}
