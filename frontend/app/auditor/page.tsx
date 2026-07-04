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
  INFO: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  WARNING: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  ERROR: 'bg-red-500/15 text-red-400 border-red-500/30',
  CRITICAL: 'bg-red-600/20 text-red-300 border-red-600/30',
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
  PRICE_DEVIATION: '\u21C5',
  SIGNAL_LATENCY: '\u23F1',
  PNL_MISMATCH: '\u2260',
  SLIPPAGE: '\u2198',
  MISSED_FILL: '\u2298',
  LIQUIDATION_RISK: '\u26A0',
  BACKTEST_DIVERGENCE: '\u27F7',
  ORDER_REJECTED: '\u2715',
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

  useEffect(() => { loadData(); }, [selectedStrategy, filterSeverity, filterCategory]);

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
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
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
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Auditor</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Reconciliação e verificação de trades com a exchange</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedStrategy}
            onChange={(e) => setSelectedStrategy(e.target.value)}
            className="bg-secondary/80 border border-border/60 rounded-md px-3 py-2 text-xs min-w-[180px] text-foreground focus:border-primary/50 outline-none transition"
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
            className="px-3 py-2 bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:bg-secondary disabled:text-muted-foreground disabled:border-border/40 rounded-md text-xs font-medium transition flex items-center gap-2"
          >
            {reconciling && <span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />}
            {reconciling ? 'Reconciliando...' : 'Reconciliar'}
          </button>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-3 py-2 bg-secondary/80 hover:bg-secondary text-muted-foreground hover:text-foreground border border-border/40 rounded-md text-xs transition"
          >
            Atualizar
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Total de Issues" value={summary.total} />
          {summary.bySeverity.map((s) => (
            <SummaryCard key={s.severity} label={s.severity} value={parseInt(s.count)} severity={s.severity} />
          ))}
        </div>
      )}

      {summary && summary.byCategory.length > 0 && (
        <div className="glass-card rounded-lg p-4">
          <h3 className="text-[10px] font-semibold mb-2.5 text-muted-foreground uppercase tracking-wider">Issues por Categoria</h3>
          <div className="flex flex-wrap gap-1.5">
            {summary.byCategory.map((c) => (
              <button
                key={c.category}
                onClick={() => setFilterCategory(filterCategory === c.category ? '' : c.category)}
                className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition border ${
                  filterCategory === c.category
                    ? 'bg-primary/15 border-primary/30 text-primary'
                    : 'bg-secondary/60 border-border/40 text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                <span className="mr-1">{CATEGORY_ICONS[c.category] || '\u2022'}</span>
                {CATEGORY_LABELS[c.category] || c.category}: <span className="font-bold ml-0.5">{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-border/40">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
            activeTab === 'logs'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Audit Logs ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('reconcile')}
          className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
            activeTab === 'reconcile'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Reconciliação {reconcileResult && !reconcileResult.error ? `(${reconcileResult.tradesAudited} trades)` : ''}
        </button>
      </div>

      {activeTab === 'logs' && (
        <div className="glass-card rounded-lg">
          <div className="flex items-center gap-2 p-3 border-b border-border/40 flex-wrap">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Filtros</span>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="bg-secondary/80 border border-border/40 rounded-md px-2 py-1.5 text-[10px] text-foreground focus:border-primary/50 outline-none"
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
              className="bg-secondary/80 border border-border/40 rounded-md px-2 py-1.5 text-[10px] text-foreground focus:border-primary/50 outline-none"
            >
              <option value="">Todas Categorias</option>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {(filterSeverity || filterCategory) && (
              <button
                onClick={() => { setFilterSeverity(''); setFilterCategory(''); }}
                className="text-[10px] text-muted-foreground hover:text-foreground transition"
              >
                Limpar
              </button>
            )}
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{logs.length} logs</span>
          </div>

          <div className="max-h-[700px] overflow-auto scrollbar-thin">
            {logs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-xs">
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    Carregando...
                  </div>
                ) : (
                  <div>
                    <p className="text-sm mb-1">Nenhum log de auditoria encontrado</p>
                    <p className="text-muted-foreground/60">Selecione uma estratégia e execute uma reconciliação</p>
                  </div>
                )}
              </div>
            ) : (
              Object.entries(groupedLogs).map(([tradeId, tradeLogs]) => (
                <div key={tradeId} className="border-b border-border/30 last:border-b-0">
                  <button
                    onClick={() => setExpandedTrade(expandedTrade === tradeId ? null : tradeId)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition text-left"
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[worstSeverity(tradeLogs)] || 'bg-muted-foreground'}`} />
                    <span className="text-[10px] font-mono text-muted-foreground w-20 flex-shrink-0 truncate" title={tradeId}>
                      {tradeId === 'general' ? 'Geral' : tradeId.slice(0, 8) + '...'}
                    </span>
                    <span className="text-xs text-foreground/80 flex-1">
                      {tradeLogs.length} issue{tradeLogs.length > 1 ? 's' : ''}
                    </span>
                    <div className="flex gap-1 flex-shrink-0">
                      {tradeLogs.some(l => l.severity === 'ERROR' || l.severity === 'CRITICAL') && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/15 text-red-400 border border-red-500/20">
                          {tradeLogs.filter(l => l.severity === 'ERROR' || l.severity === 'CRITICAL').length} ERR
                        </span>
                      )}
                      {tradeLogs.some(l => l.severity === 'WARNING') && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                          {tradeLogs.filter(l => l.severity === 'WARNING').length} WARN
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                      {new Date(tradeLogs[0].createdAt).toLocaleDateString()}
                    </span>
                    <ChevronIcon open={expandedTrade === tradeId} />
                  </button>

                  {expandedTrade === tradeId && (
                    <div className="bg-secondary/10 border-t border-border/20">
                      {tradeLogs.map((log) => (
                        <div key={log.id} className="border-b border-border/10 last:border-b-0">
                          <button
                            onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                            className="w-full flex items-start gap-2.5 px-6 py-2 hover:bg-secondary/10 transition text-left"
                          >
                            <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${SEVERITY_DOT[log.severity] || 'bg-muted-foreground'}`} />
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex-shrink-0 ${SEVERITY_COLORS[log.severity] || ''}`}>
                              {log.severity}
                            </span>
                            <span className="text-[10px] text-muted-foreground font-medium flex-shrink-0 w-24">
                              {CATEGORY_LABELS[log.category] || log.category}
                            </span>
                            <span className="text-[10px] text-foreground/80 flex-1 break-words whitespace-pre-wrap leading-relaxed">
                              {log.message}
                            </span>
                            {(log.deviation !== null || log.expectedValue !== null) && (
                              <ChevronIcon open={expandedLog === log.id} size={12} />
                            )}
                          </button>

                          {expandedLog === log.id && (
                            <div className="px-6 pb-3 pl-14">
                              <div className="bg-secondary/40 rounded-md border border-border/30 p-3 space-y-2">
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-[10px]">
                                  {log.expectedValue !== null && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Valor Esperado</div>
                                      <div className="font-mono text-emerald-400">{formatNum(log.expectedValue)}</div>
                                    </div>
                                  )}
                                  {log.actualValue !== null && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Valor Registrado</div>
                                      <div className="font-mono text-yellow-400">{formatNum(log.actualValue)}</div>
                                    </div>
                                  )}
                                  {log.deviation !== null && (
                                    <div>
                                      <div className="text-muted-foreground/60 mb-0.5">Desvio</div>
                                      <div className={`font-mono ${Math.abs(log.deviation) > 1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                        {formatNum(log.deviation)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {log.details && Object.keys(log.details).length > 0 && (
                                  <div className="pt-2 border-t border-border/20">
                                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1">Detalhes</div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                                      {Object.entries(log.details).map(([k, v]) => (
                                        <div key={k} className="flex justify-between gap-2">
                                          <span className="text-muted-foreground/60">{k.replace(/_/g, ' ')}</span>
                                          <span className="font-mono text-foreground/80 text-right truncate max-w-[180px]" title={String(v)}>
                                            {typeof v === 'number' ? formatNum(v) : String(v)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <div className="pt-1 text-[9px] text-muted-foreground/40 font-mono">
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

      {activeTab === 'reconcile' && (
        <div className="space-y-4">
          {!reconcileResult && !reconciling && (
            <div className="glass-card rounded-lg p-12 text-center text-muted-foreground">
              <p className="text-sm mb-1">Nenhuma reconciliação executada</p>
              <p className="text-xs text-muted-foreground/60">Selecione uma estratégia e clique em &quot;Reconciliar&quot;</p>
            </div>
          )}

          {reconciling && (
            <div className="glass-card rounded-lg p-12 text-center">
              <div className="flex items-center justify-center gap-3 text-foreground/80">
                <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Reconciliando trades com a exchange...
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-2">Buscando ordens na exchange para cada trade fechado</p>
            </div>
          )}

          {reconcileResult && reconcileResult.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400 text-xs">{reconcileResult.error}</p>
            </div>
          )}

          {reconcileResult && !reconcileResult.error && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <SummaryCard label="Trades Auditados" value={reconcileResult.tradesAudited} />
                <SummaryCard label="Issues" value={reconcileResult.totalIssues} severity={reconcileResult.totalIssues > 0 ? 'WARNING' : undefined} />
                <SummaryCard label="Slippage Médio" value={`${reconcileResult.avgSlippagePct.toFixed(4)}%`} severity={reconcileResult.avgSlippagePct > 0.1 ? 'WARNING' : undefined} />
                <SummaryCard label="Latência Média" value={`${reconcileResult.avgSignalLatencyMs.toFixed(0)}ms`} severity={reconcileResult.avgSignalLatencyMs > 5000 ? 'WARNING' : undefined} />
                <SummaryCard label="Taxas Exchange" value={`$${reconcileResult.totalFeesNotAccountedFor.toFixed(4)}`} severity="WARNING" />
              </div>

              <div className="glass-card rounded-lg">
                <div className="px-4 py-3 border-b border-border/40">
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Resultado por Trade</h3>
                </div>
                <div className="max-h-[600px] overflow-auto scrollbar-thin">
                  {reconcileResult.trades.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-xs">Nenhum trade fechado encontrado</div>
                  ) : (
                    reconcileResult.trades.map((tr) => (
                      <div key={tr.tradeId} className="border-b border-border/30 last:border-b-0">
                        <button
                          onClick={() => setExpandedTrade(expandedTrade === `rec-${tr.tradeId}` ? null : `rec-${tr.tradeId}`)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition text-left"
                        >
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                            tr.issues.length === 0 ? 'bg-emerald-400' :
                            tr.issues.some(i => i.severity === 'ERROR' || i.severity === 'CRITICAL') ? 'bg-red-400' :
                            'bg-yellow-400'
                          }`} />
                          <span className="text-[10px] font-mono text-muted-foreground w-16 flex-shrink-0">{tr.tradeId.slice(0, 8)}...</span>

                          <div className="flex items-center gap-3 flex-1 text-[10px] flex-wrap">
                            <span className="text-muted-foreground font-mono">
                              Entry: <span className="text-foreground">${tr.botData.entryPrice.toFixed(4)}</span>
                            </span>
                            {tr.botData.exitPrice !== null && (
                              <span className="text-muted-foreground font-mono">
                                Exit: <span className="text-foreground">${tr.botData.exitPrice.toFixed(4)}</span>
                              </span>
                            )}
                            {tr.botData.pnl !== null && (
                              <span className={`font-mono font-semibold ${tr.botData.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {tr.botData.pnl >= 0 ? '+' : ''}{tr.botData.pnl.toFixed(4)}
                              </span>
                            )}
                            {tr.slippage !== null && (
                              <span className={`font-mono ${tr.slippage > 0.1 ? 'text-yellow-400' : 'text-muted-foreground/60'}`}>
                                Slip: {tr.slippage.toFixed(4)}%
                              </span>
                            )}
                            {tr.signalLatencyMs !== null && (
                              <span className={`font-mono ${tr.signalLatencyMs > 5000 ? 'text-yellow-400' : 'text-muted-foreground/60'}`}>
                                {tr.signalLatencyMs}ms
                              </span>
                            )}
                          </div>

                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border flex-shrink-0 ${
                            tr.issues.length === 0
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
                          }`}>
                            {tr.issues.length === 0 ? 'OK' : `${tr.issues.length} issues`}
                          </span>
                          <ChevronIcon open={expandedTrade === `rec-${tr.tradeId}`} />
                        </button>

                        {expandedTrade === `rec-${tr.tradeId}` && (
                          <div className="bg-secondary/10 border-t border-border/20 px-5 py-4 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <DetailBox title="Dados do Bot">
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  <KV label="Entry Price" value={`$${tr.botData.entryPrice.toFixed(8)}`} />
                                  <KV label="Exit Price" value={tr.botData.exitPrice !== null ? `$${tr.botData.exitPrice.toFixed(8)}` : '-'} />
                                  <KV label="Quantity" value={String(tr.botData.quantity)} />
                                  <KV label="P&L" value={tr.botData.pnl !== null ? `$${tr.botData.pnl.toFixed(4)}` : '-'} valueColor={(tr.botData.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                                </div>
                              </DetailBox>
                              <DetailBox title="Dados da Exchange">
                                {tr.exchangeData ? (
                                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                                    <KV label="Avg Price" value={`$${tr.exchangeData.avgPrice.toFixed(8)}`} />
                                    <KV label="Filled Qty" value={String(tr.exchangeData.executedQty)} />
                                    <KV label="Commission" value={`$${tr.exchangeData.commission.toFixed(6)}`} valueColor="text-yellow-400" />
                                    <KV label="Status" value={tr.exchangeData.status} valueColor={tr.exchangeData.status === 'closed' || tr.exchangeData.status === 'FILLED' ? 'text-emerald-400' : 'text-yellow-400'} />
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-muted-foreground/60">Dados da exchange indisponíveis</div>
                                )}
                              </DetailBox>
                            </div>

                            <DetailBox title="Cálculos do Auditor">
                              <div className="flex flex-wrap gap-4 text-[10px]">
                                {tr.calculatedPnl !== null && (
                                  <KV label="P&L Calculado" value={`$${tr.calculatedPnl.toFixed(4)}`} valueColor={tr.calculatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                                )}
                                <KV label="Taxas Exchange" value={`$${tr.feesFromExchange.toFixed(6)}`} valueColor="text-yellow-400" />
                                {tr.slippage !== null && (
                                  <KV label="Slippage" value={`${tr.slippage.toFixed(4)}%`} valueColor={tr.slippage > 0.1 ? 'text-yellow-400' : 'text-foreground/80'} />
                                )}
                                {tr.signalLatencyMs !== null && (
                                  <KV label="Latência" value={`${tr.signalLatencyMs}ms`} valueColor={tr.signalLatencyMs > 5000 ? 'text-yellow-400' : 'text-foreground/80'} />
                                )}
                              </div>
                            </DetailBox>

                            {tr.issues.length > 0 && (
                              <div>
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">Issues</div>
                                <div className="space-y-1">
                                  {tr.issues.map((issue, idx) => (
                                    <div key={idx} className={`px-3 py-2 rounded-md text-[10px] border ${
                                      issue.severity === 'ERROR' || issue.severity === 'CRITICAL'
                                        ? 'bg-red-500/10 border-red-500/15 text-red-300'
                                        : 'bg-yellow-500/10 border-yellow-500/15 text-yellow-300'
                                    }`}>
                                      <span className="font-bold mr-1.5">[{issue.severity}]</span>
                                      <span className="break-words whitespace-pre-wrap">{issue.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {tr.issues.length === 0 && (
                              <div className="text-[10px] text-emerald-400/60 text-center py-2">
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
  const colorClass = severity ? (SEVERITY_COLORS[severity] || '') : 'text-foreground border-border/60';
  return (
    <div className={`glass-card rounded-lg p-3 ${colorClass}`}>
      <div className="text-[10px] opacity-70 mb-1">{label}</div>
      <div className="text-lg font-bold font-mono">{value}</div>
    </div>
  );
}

function DetailBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-secondary/30 rounded-md border border-border/20 p-3">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-2">{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <span className="text-muted-foreground/60">{label}:</span>
      <span className={`font-mono ml-1.5 ${valueColor || 'text-foreground/80'}`}>{value}</span>
    </div>
  );
}

function ChevronIcon({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`text-muted-foreground/50 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function formatNum(v: number): string {
  if (Math.abs(v) < 0.0001) return v.toExponential(2);
  if (Math.abs(v) < 1) return v.toFixed(6);
  if (Math.abs(v) < 100) return v.toFixed(4);
  return v.toFixed(2);
}
