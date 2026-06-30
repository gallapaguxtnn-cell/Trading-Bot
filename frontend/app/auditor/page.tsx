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

interface ReconcileTradeResult {
  tradeId: string;
  issues: AuditLog[];
  exchangeData: {
    orderId: string;
    avgPrice: number;
    executedQty: number;
    commission: number;
    status: string;
  } | null;
  botData: {
    entryPrice: number;
    exitPrice: number | null;
    quantity: number;
    pnl: number | null;
  };
  calculatedPnl: number | null;
  feesFromExchange: number;
  feesFromBot: number;
  slippage: number | null;
  signalLatencyMs: number | null;
}

interface ReconcileResult {
  strategyId: string;
  tradesAudited: number;
  totalIssues: number;
  totalFeesNotAccountedFor: number;
  avgSlippagePct: number;
  avgSignalLatencyMs: number;
  trades: ReconcileTradeResult[];
  error?: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  INFO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WARNING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  CRITICAL: 'bg-red-600/30 text-red-300 border-red-600/40',
};

const SEVERITY_DOT: Record<string, string> = {
  INFO: 'bg-blue-400',
  WARNING: 'bg-yellow-400',
  ERROR: 'bg-red-400',
  CRITICAL: 'bg-red-300',
};

const CATEGORY_LABELS: Record<string, string> = {
  FEE_MISMATCH: 'Fee Mismatch',
  PRICE_DEVIATION: 'Desvio de Preço',
  SIGNAL_LATENCY: 'Latência do Sinal',
  PNL_MISMATCH: 'P&L Divergente',
  SLIPPAGE: 'Slippage',
  MISSED_FILL: 'Fill Incompleto',
  LIQUIDATION_RISK: 'Risco de Liquidação',
  BACKTEST_DIVERGENCE: 'Divergência Backtest',
  ORDER_REJECTED: 'Ordem Rejeitada',
};

const CATEGORY_ICONS: Record<string, string> = {
  FEE_MISMATCH: '$',
  PRICE_DEVIATION: '⇅',
  SIGNAL_LATENCY: '⏱',
  PNL_MISMATCH: '≠',
  SLIPPAGE: '↘',
  MISSED_FILL: '⊘',
  LIQUIDATION_RISK: '⚠',
  BACKTEST_DIVERGENCE: '⟷',
  ORDER_REJECTED: '✕',
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
  const [reconcileResult, setReconcileResult] = useState<ReconcileResult | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'logs' | 'reconcile'>('logs');

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
        getAuditLogs({ strategyId: sid, severity: filterSeverity || undefined, category: filterCategory || undefined, limit: 200 }),
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
    setActiveTab('reconcile');
    try {
      const result = await reconcileStrategy(selectedStrategy);
      setReconcileResult(result as ReconcileResult);
      await loadData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setReconcileResult({ error: msg } as ReconcileResult);
    }
    setReconciling(false);
  };

  const groupedLogs = logs.reduce<Record<string, AuditLog[]>>((acc, log) => {
    const key = log.tradeId || 'general';
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  const worstSeverity = (issues: AuditLog[]) => {
    if (issues.some(i => i.severity === 'CRITICAL')) return 'CRITICAL';
    if (issues.some(i => i.severity === 'ERROR')) return 'ERROR';
    if (issues.some(i => i.severity === 'WARNING')) return 'WARNING';
    return 'INFO';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Auditor</h1>
          <p className="text-sm text-slate-400 mt-1">Reconciliação e verificação de trades com a exchange</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[200px]"
          >
            <option value="">Todas as Estratégias</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || s.symbol} ({s.exchange}) {s.isActive ? '' : '[Inativa]'}
              </option>
            ))}
          </select>
          <button
            onClick={handleReconcile}
            disabled={!selectedStrategy || reconciling}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-sm font-medium transition flex items-center gap-2"
          >
            {reconciling && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {reconciling ? 'Reconciliando...' : 'Reconciliar Estratégia'}
          </button>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard label="Total de Issues" value={summary.total} />
          {summary.bySeverity.map((s) => (
            <SummaryCard key={s.severity} label={s.severity} value={parseInt(s.count)} severity={s.severity} />
          ))}
        </div>
      )}

      {/* Category breakdown */}
      {summary && summary.byCategory.length > 0 && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-4">
          <h3 className="text-sm font-semibold mb-3 text-slate-300">Issues por Categoria</h3>
          <div className="flex flex-wrap gap-2">
            {summary.byCategory.map((c) => (
              <button
                key={c.category}
                onClick={() => setFilterCategory(filterCategory === c.category ? '' : c.category)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
                  filterCategory === c.category
                    ? 'bg-blue-600/30 border-blue-500/50 text-blue-300'
                    : 'bg-slate-700/60 border-slate-600/50 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span className="mr-1.5">{CATEGORY_ICONS[c.category] || '•'}</span>
                {CATEGORY_LABELS[c.category] || c.category}: <span className="font-bold ml-1">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-700">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'logs'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Audit Logs ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('reconcile')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === 'reconcile'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          Reconciliação {reconcileResult && !reconcileResult.error ? `(${reconcileResult.tradesAudited} trades)` : ''}
        </button>
      </div>

      {/* Logs tab */}
      {activeTab === 'logs' && (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700">
          {/* Filters */}
          <div className="flex items-center gap-3 p-4 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-300">Filtros</h3>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs"
            >
              <option value="">Todas Severidades</option>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="ERROR">Error</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-2.5 py-1.5 text-xs"
            >
              <option value="">Todas Categorias</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {(filterSeverity || filterCategory) && (
              <button
                onClick={() => { setFilterSeverity(''); setFilterCategory(''); }}
                className="text-xs text-slate-400 hover:text-white transition"
              >
                Limpar filtros
              </button>
            )}
            <span className="text-xs text-slate-500 ml-auto">{logs.length} logs</span>
          </div>

          {/* Grouped logs */}
          <div className="max-h-[700px] overflow-auto">
            {logs.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm">
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-slate-500/30 border-t-slate-400 rounded-full animate-spin" />
                    Carregando...
                  </div>
                ) : (
                  <div>
                    <p className="text-base mb-1">Nenhum log de auditoria encontrado</p>
                    <p className="text-slate-600">Selecione uma estratégia e execute uma reconciliação</p>
                  </div>
                )}
              </div>
            ) : (
              Object.entries(groupedLogs).map(([tradeId, tradeLogs]) => (
                <div key={tradeId} className="border-b border-slate-700/50 last:border-b-0">
                  {/* Trade group header */}
                  <button
                    onClick={() => setExpandedTrade(expandedTrade === tradeId ? null : tradeId)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/20 transition text-left"
                  >
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[worstSeverity(tradeLogs)] || 'bg-slate-500'}`} />
                    <span className="text-xs font-mono text-slate-400 w-24 flex-shrink-0 truncate" title={tradeId}>
                      {tradeId === 'general' ? 'Geral' : tradeId.slice(0, 8) + '...'}
                    </span>
                    <span className="text-sm text-slate-300 flex-1">
                      {tradeLogs.length} issue{tradeLogs.length > 1 ? 's' : ''}
                    </span>
                    <div className="flex gap-1.5 flex-shrink-0">
                      {tradeLogs.some(l => l.severity === 'ERROR' || l.severity === 'CRITICAL') && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                          {tradeLogs.filter(l => l.severity === 'ERROR' || l.severity === 'CRITICAL').length} ERR
                        </span>
                      )}
                      {tradeLogs.some(l => l.severity === 'WARNING') && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                          {tradeLogs.filter(l => l.severity === 'WARNING').length} WARN
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      {new Date(tradeLogs[0].createdAt).toLocaleDateString()}
                    </span>
                    <svg className={`w-4 h-4 text-slate-500 transition-transform ${expandedTrade === tradeId ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded log entries */}
                  {expandedTrade === tradeId && (
                    <div className="bg-slate-900/30 border-t border-slate-700/30">
                      {tradeLogs.map((log) => (
                        <div key={log.id} className="border-b border-slate-800/50 last:border-b-0">
                          <button
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            className="w-full flex items-start gap-3 px-6 py-2.5 hover:bg-slate-700/10 transition text-left"
                          >
                            <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[log.severity] || 'bg-slate-500'}`} />
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${SEVERITY_COLORS[log.severity] || ''}`}>
                              {log.severity}
                            </span>
                            <span className="text-xs text-slate-400 font-medium flex-shrink-0 w-28">
                              {CATEGORY_LABELS[log.category] || log.category}
                            </span>
                            <span className="text-xs text-slate-300 flex-1 break-words whitespace-pre-wrap">
                              {log.message}
                            </span>
                            {(log.deviation !== null || log.expectedValue !== null) && (
                              <svg className={`w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5 transition-transform ${expandedLog === log.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            )}
                          </button>

                          {/* Detail panel */}
                          {expandedLog === log.id && (
                            <div className="px-6 pb-3 pl-16">
                              <div className="bg-slate-800/80 rounded-lg border border-slate-700/50 p-3 space-y-2">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                                  {log.expectedValue !== null && (
                                    <div>
                                      <div className="text-slate-500 mb-0.5">Valor Esperado</div>
                                      <div className="font-mono text-green-400">{formatNum(log.expectedValue)}</div>
                                    </div>
                                  )}
                                  {log.actualValue !== null && (
                                    <div>
                                      <div className="text-slate-500 mb-0.5">Valor Registrado</div>
                                      <div className="font-mono text-yellow-400">{formatNum(log.actualValue)}</div>
                                    </div>
                                  )}
                                  {log.deviation !== null && (
                                    <div>
                                      <div className="text-slate-500 mb-0.5">Desvio</div>
                                      <div className={`font-mono ${Math.abs(log.deviation) > 1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                        {formatNum(log.deviation)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div className="pt-2 border-t border-slate-700/50">
                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Detalhes</div>
                                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                      {Object.entries(log.details).map(([k, v]) => (
                                        <div key={k} className="flex justify-between gap-2">
                                          <span className="text-slate-500">{k.replace(/_/g, ' ')}</span>
                                          <span className="font-mono text-slate-300 text-right truncate max-w-[200px]" title={String(v)}>
                                            {typeof v === 'number' ? formatNum(v) : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <div className="pt-1 text-[10px] text-slate-600 font-mono">
                                  {new Date(log.createdAt).toLocaleString()} | Trade: {log.tradeId.slice(0, 12)}...
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Reconcile tab */}
      {activeTab === 'reconcile' && (
        <div className="space-y-4">
          {!reconcileResult && !reconciling && (
            <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-12 text-center text-slate-500">
              <p className="text-base mb-1">Nenhuma reconciliação executada</p>
              <p className="text-sm text-slate-600">Selecione uma estratégia e clique em &quot;Reconciliar Estratégia&quot;</p>
            </div>
          )}

          {reconciling && (
            <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-12 text-center">
              <div className="flex items-center justify-center gap-3 text-slate-300">
                <span className="w-5 h-5 border-2 border-slate-500/30 border-t-blue-400 rounded-full animate-spin" />
                Reconciliando trades com a exchange...
              </div>
              <p className="text-xs text-slate-500 mt-2">Buscando ordens na exchange para cada trade fechado</p>
            </div>
          )}

          {reconcileResult && reconcileResult.error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 text-sm">{reconcileResult.error}</p>
            </div>
          )}

          {reconcileResult && !reconcileResult.error && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <SummaryCard label="Trades Auditados" value={reconcileResult.tradesAudited} />
                <SummaryCard label="Issues Encontradas" value={reconcileResult.totalIssues} severity={reconcileResult.totalIssues > 0 ? 'WARNING' : undefined} />
                <SummaryCard label="Slippage Médio" value={`${reconcileResult.avgSlippagePct.toFixed(4)}%`} severity={reconcileResult.avgSlippagePct > 0.1 ? 'WARNING' : undefined} />
                <SummaryCard label="Latência Média" value={`${reconcileResult.avgSignalLatencyMs.toFixed(0)}ms`} severity={reconcileResult.avgSignalLatencyMs > 5000 ? 'WARNING' : undefined} />
                <SummaryCard label="Taxas Exchange" value={`$${reconcileResult.totalFeesNotAccountedFor.toFixed(4)}`} severity="WARNING" />
              </div>

              {/* Per-trade results */}
              <div className="bg-slate-800/60 rounded-xl border border-slate-700">
                <div className="px-4 py-3 border-b border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-300">Resultado por Trade</h3>
                </div>
                <div className="max-h-[600px] overflow-auto">
                  {reconcileResult.trades.length === 0 ? (
                    <div className="p-8 text-center text-slate-500 text-sm">Nenhum trade fechado encontrado</div>
                  ) : (
                    reconcileResult.trades.map((tr) => (
                      <div key={tr.tradeId} className="border-b border-slate-700/50 last:border-b-0">
                        <button
                          onClick={() => setExpandedTrade(expandedTrade === `rec-${tr.tradeId}` ? null : `rec-${tr.tradeId}`)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-700/20 transition text-left"
                        >
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                            tr.issues.length === 0 ? 'bg-emerald-400' :
                            tr.issues.some(i => i.severity === 'ERROR' || i.severity === 'CRITICAL') ? 'bg-red-400' :
                            'bg-yellow-400'
                          }`} />
                          <span className="text-xs font-mono text-slate-400 w-20 flex-shrink-0">{tr.tradeId.slice(0, 8)}...</span>

                          {/* Bot data */}
                          <div className="flex items-center gap-3 flex-1 text-xs">
                            <span className="text-slate-300 font-mono">
                              Entry: <span className="text-white">${tr.botData.entryPrice.toFixed(4)}</span>
                            </span>
                            {tr.botData.exitPrice !== null && (
                              <span className="text-slate-300 font-mono">
                                Exit: <span className="text-white">${tr.botData.exitPrice.toFixed(4)}</span>
                              </span>
                            )}
                            {tr.botData.pnl !== null && (
                              <span className={`font-mono font-semibold ${tr.botData.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                P&L: {tr.botData.pnl >= 0 ? '+' : ''}{tr.botData.pnl.toFixed(4)}
                              </span>
                            )}
                            {tr.slippage !== null && (
                              <span className={`font-mono ${tr.slippage > 0.1 ? 'text-yellow-400' : 'text-slate-400'}`}>
                                Slip: {tr.slippage.toFixed(4)}%
                              </span>
                            )}
                            {tr.signalLatencyMs !== null && (
                              <span className={`font-mono ${tr.signalLatencyMs > 5000 ? 'text-yellow-400' : 'text-slate-400'}`}>
                                Lat: {tr.signalLatencyMs}ms
                              </span>
                            )}
                          </div>

                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            tr.issues.length === 0
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                          }`}>
                            {tr.issues.length === 0 ? 'OK' : `${tr.issues.length} issues`}
                          </span>

                          <svg className={`w-4 h-4 text-slate-500 transition-transform ${expandedTrade === `rec-${tr.tradeId}` ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>

                        {expandedTrade === `rec-${tr.tradeId}` && (
                          <div className="bg-slate-900/30 border-t border-slate-700/30 px-6 py-4 space-y-3">
                            {/* Exchange vs Bot comparison */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-slate-800/80 rounded-lg border border-slate-700/50 p-3">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Dados do Bot</div>
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div>
                                    <span className="text-slate-500">Entry Price:</span>
                                    <span className="font-mono text-white ml-2">${tr.botData.entryPrice.toFixed(8)}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Exit Price:</span>
                                    <span className="font-mono text-white ml-2">{tr.botData.exitPrice !== null ? `$${tr.botData.exitPrice.toFixed(8)}` : '-'}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">Quantity:</span>
                                    <span className="font-mono text-white ml-2">{tr.botData.quantity}</span>
                                  </div>
                                  <div>
                                    <span className="text-slate-500">P&L:</span>
                                    <span className={`font-mono ml-2 ${(tr.botData.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {tr.botData.pnl !== null ? `$${tr.botData.pnl.toFixed(4)}` : '-'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="bg-slate-800/80 rounded-lg border border-slate-700/50 p-3">
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Dados da Exchange</div>
                                {tr.exchangeData ? (
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <span className="text-slate-500">Avg Price:</span>
                                      <span className="font-mono text-white ml-2">${tr.exchangeData.avgPrice.toFixed(8)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Filled Qty:</span>
                                      <span className="font-mono text-white ml-2">{tr.exchangeData.executedQty}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Commission:</span>
                                      <span className="font-mono text-yellow-400 ml-2">${tr.exchangeData.commission.toFixed(6)}</span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500">Status:</span>
                                      <span className={`font-mono ml-2 ${tr.exchangeData.status === 'closed' || tr.exchangeData.status === 'FILLED' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                                        {tr.exchangeData.status}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="text-xs text-slate-500">Dados da exchange indisponíveis</div>
                                )}
                              </div>
                            </div>

                            {/* Calculated values */}
                            <div className="bg-slate-800/80 rounded-lg border border-slate-700/50 p-3">
                              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Cálculos do Auditor</div>
                              <div className="flex flex-wrap gap-6 text-xs">
                                {tr.calculatedPnl !== null && (
                                  <div>
                                    <span className="text-slate-500">P&L Calculado:</span>
                                    <span className={`font-mono ml-2 ${tr.calculatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      ${tr.calculatedPnl.toFixed(4)}
                                    </span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-slate-500">Taxas Exchange:</span>
                                  <span className="font-mono text-yellow-400 ml-2">${tr.feesFromExchange.toFixed(6)}</span>
                                </div>
                                {tr.slippage !== null && (
                                  <div>
                                    <span className="text-slate-500">Slippage:</span>
                                    <span className={`font-mono ml-2 ${tr.slippage > 0.1 ? 'text-yellow-400' : 'text-slate-300'}`}>
                                      {tr.slippage.toFixed(4)}%
                                    </span>
                                  </div>
                                )}
                                {tr.signalLatencyMs !== null && (
                                  <div>
                                    <span className="text-slate-500">Latência:</span>
                                    <span className={`font-mono ml-2 ${tr.signalLatencyMs > 5000 ? 'text-yellow-400' : 'text-slate-300'}`}>
                                      {tr.signalLatencyMs}ms
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Issues for this trade */}
                            {tr.issues.length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Issues</div>
                                <div className="space-y-1">
                                  {tr.issues.map((issue, idx) => (
                                    <div key={idx} className={`px-3 py-2 rounded-lg text-xs border ${
                                      issue.severity === 'ERROR' || issue.severity === 'CRITICAL'
                                        ? 'bg-red-500/10 border-red-500/20 text-red-300'
                                        : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300'
                                    }`}>
                                      <span className="font-semibold mr-2">[{issue.severity}]</span>
                                      <span className="break-words whitespace-pre-wrap">{issue.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {tr.issues.length === 0 && (
                              <div className="text-xs text-emerald-400/60 text-center py-2">
                                Nenhum problema encontrado neste trade
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, severity }: { label: string; value: number | string; severity?: string }) {
  const colorClass = severity ? (SEVERITY_COLORS[severity] || '') : 'bg-slate-700/50 text-white border-slate-600';
  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <div className="text-xs opacity-80 mb-1">{label}</div>
      <div className="text-2xl font-bold font-mono">{value}</div>
    </div>
  );
}

function formatNum(v: number): string {
  if (Math.abs(v) < 0.0001) return v.toExponential(2);
  if (Math.abs(v) < 1) return v.toFixed(6);
  if (Math.abs(v) < 100) return v.toFixed(4);
  return v.toFixed(2);
}
