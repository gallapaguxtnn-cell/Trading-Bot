'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchStrategies, getAuditSummary, getAuditLogs, reconcileStrategy } from '../../lib/api';

interface AuditLog {
  id: string;
  tradeId: string;
  strategyId: string;
  category: string;
  severity: string;
  message: string;
  details: Record<string, unknown>;
  expectedValue: number | null;
  actualValue: number | null;
  deviation: number | null;
  createdAt: string;
}

interface Strategy {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  isActive: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WARNING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  CRITICAL: 'bg-red-600/30 text-red-300 border-red-600/40',
};

const CATEGORY_LABELS: Record<string, string> = {
  FEE_MISMATCH: 'Fee Mismatch',
  PRICE_DEVIATION: 'Price Deviation',
  SIGNAL_LATENCY: 'Signal Latency',
  PNL_MISMATCH: 'P&L Mismatch',
  SLIPPAGE: 'Slippage',
  MISSED_FILL: 'Missed Fill',
  LIQUIDATION_RISK: 'Liquidation Risk',
  BACKTEST_DIVERGENCE: 'Backtest Divergence',
  ORDER_REJECTED: 'Order Rejected',
};

export default function AuditorPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [summary, setSummary] = useState<{ total: number; bySeverity: Array<{ severity: string; count: string }>; byCategory: Array<{ category: string; count: string }> } | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchStrategies().then(setStrategies).catch(() => {});
    loadData();
  }, []);

  const loadData = useCallback(async (stratId?: string) => {
    setLoading(true);
    try {
      const sid = stratId || selectedStrategy || undefined;
      const [s, l] = await Promise.all([
        getAuditSummary(sid),
        getAuditLogs({ strategyId: sid, severity: filterSeverity || undefined, category: filterCategory || undefined, limit: 100 }),
      ]);
      setSummary(s);
      setLogs(l);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [selectedStrategy, filterSeverity, filterCategory]);

  useEffect(() => {
    loadData();
  }, [selectedStrategy, filterSeverity, filterCategory]);

  const handleReconcile = async () => {
    if (!selectedStrategy) return;
    setReconciling(true);
    setReconcileResult(null);
    try {
      const result = await reconcileStrategy(selectedStrategy);
      setReconcileResult(result);
      await loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setReconcileResult({ error: msg });
    }
    setReconciling(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Auditor</h1>
        <div className="flex items-center gap-3">
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
          >
            <option value="">All Strategies</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.symbol} ({s.exchange})
              </option>
            ))}
          </select>
          <button
            onClick={handleReconcile}
            disabled={!selectedStrategy || reconciling}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-medium transition"
          >
            {reconciling ? 'Reconciling...' : 'Reconcile Strategy'}
          </button>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Total Issues" value={summary.total} />
          {summary.bySeverity.map((s) => (
            <SummaryCard key={s.severity} label={s.severity} value={parseInt(s.count)} severity={s.severity} />
          ))}
        </div>
      )}

      {summary && summary.byCategory.length > 0 && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
          <h3 className="text-sm font-semibold mb-3 text-slate-300">Issues by Category</h3>
          <div className="flex flex-wrap gap-2">
            {summary.byCategory.map((c) => (
              <span key={c.category} className="px-3 py-1 bg-slate-700 rounded text-xs">
                {CATEGORY_LABELS[c.category] || c.category}: <span className="font-bold">{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {reconcileResult && (
        <div className={`rounded-lg border p-4 ${
          'error' in reconcileResult ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
        }`}>
          {'error' in reconcileResult ? (
            <p className="text-red-400 text-sm">{String(reconcileResult.error)}</p>
          ) : (
            <div className="text-sm text-green-400 space-y-1">
              <p>Trades audited: <span className="font-bold">{String(reconcileResult.tradesAudited ?? 0)}</span></p>
              <p>Total issues found: <span className="font-bold">{String(reconcileResult.totalIssues ?? 0)}</span></p>
              <p>Avg slippage: <span className="font-bold">{Number(reconcileResult.avgSlippagePct ?? 0).toFixed(4)}%</span></p>
              <p>Avg latency: <span className="font-bold">{Number(reconcileResult.avgSignalLatencyMs ?? 0).toFixed(0)}ms</span></p>
              <p>Fees not accounted: <span className="font-bold">${Number(reconcileResult.totalFeesNotAccountedFor ?? 0).toFixed(4)}</span></p>
            </div>
          )}
        </div>
      )}

      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex items-center gap-3 p-4 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300">Audit Logs</h3>
          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs"
          >
            <option value="">All Severities</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs"
          >
            <option value="">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto">{logs.length} logs</span>
        </div>

        <div className="max-h-[600px] overflow-auto">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              {loading ? 'Loading...' : 'No audit logs found. Run a reconciliation to generate logs.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="border-b border-slate-700 text-xs text-slate-400">
                  <th className="text-left p-3">Time</th>
                  <th className="text-left p-3">Severity</th>
                  <th className="text-left p-3">Category</th>
                  <th className="text-left p-3">Message</th>
                  <th className="text-right p-3">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                    <td className="p-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs border ${SEVERITY_COLORS[log.severity] || ''}`}>
                        {log.severity}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      {CATEGORY_LABELS[log.category] || log.category}
                    </td>
                    <td className="p-3 text-xs max-w-md truncate" title={log.message}>
                      {log.message}
                    </td>
                    <td className="p-3 text-right text-xs font-mono">
                      {log.deviation !== null ? Number(log.deviation).toFixed(4) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, severity }: { label: string; value: number; severity?: string }) {
  const colorClass = severity ? (SEVERITY_COLORS[severity] || '') : 'bg-slate-700/50 text-white border-slate-600';
  return (
    <div className={`rounded-lg border p-4 ${colorClass}`}>
      <div className="text-xs opacity-80 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
