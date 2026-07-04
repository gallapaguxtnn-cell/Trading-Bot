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

const SEVERITY_LABELS: Record<string, string> = {
  INFO: 'Info',
  WARNING: 'Aviso',
  ERROR: 'Erro',
  CRITICAL: 'Crítico',
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  INFO: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', dot: 'bg-blue-400' },
  WARNING: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20', dot: 'bg-yellow-400' },
  ERROR: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', dot: 'bg-red-400' },
  CRITICAL: { bg: 'bg-red-600/15', text: 'text-red-300', border: 'border-red-600/25', dot: 'bg-red-300' },
};

const CATEGORY_INFO: Record<string, { label: string; icon: string; description: string }> = {
  FEE_MISMATCH: { label: 'Taxas', icon: '$', description: 'Diferença entre taxas registradas e cobradas pela exchange' },
  PRICE_DEVIATION: { label: 'Desvio de Preço', icon: '⇅', description: 'Preço executado difere do registrado pelo bot' },
  SIGNAL_LATENCY: { label: 'Latência', icon: '⏱', description: 'Tempo entre o sinal e a execução na exchange' },
  PNL_MISMATCH: { label: 'P&L Divergente', icon: '≠', description: 'Lucro/prejuízo calculado difere do registrado' },
  SLIPPAGE: { label: 'Slippage', icon: '↘', description: 'Diferença entre preço esperado e preço executado' },
  MISSED_FILL: { label: 'Fill Parcial', icon: '⊘', description: 'Ordem não foi totalmente preenchida' },
  LIQUIDATION_RISK: { label: 'Risco de Liquidação', icon: '⚠', description: 'Trade próximo do preço de liquidação' },
  BACKTEST_DIVERGENCE: { label: 'Divergência Backtest', icon: '⟷', description: 'Resultado real difere do backtest' },
  ORDER_REJECTED: { label: 'Ordem Rejeitada', icon: '✕', description: 'Ordem não encontrada ou rejeitada pela exchange' },
};

function isKnownLimitation(log: AuditLog): boolean {
  if (log.category === 'FEE_MISMATCH' && log.message.includes('bot P&L nao desconta taxas')) return true;
  if (log.category === 'FEE_MISMATCH' && log.message.includes('bot P&L não desconta taxas')) return true;
  return false;
}

function getEffectiveSeverity(log: AuditLog): string {
  if (isKnownLimitation(log)) return 'INFO';
  return log.severity;
}

function parseIssueMessage(log: AuditLog): { title: string; detail: string } {
  const cat = CATEGORY_INFO[log.category];
  const catLabel = cat?.label || log.category;

  if (isKnownLimitation(log)) {
    const fees = log.actualValue != null ? `$${Number(log.actualValue).toFixed(4)}` : '';
    return {
      title: `Taxas da exchange não descontadas do P&L`,
      detail: fees ? `Total de taxas cobradas: ${fees}. O bot ainda não desconta taxas do cálculo de P&L — limitação conhecida.` : 'Limitação conhecida: o bot não desconta taxas da exchange no cálculo de P&L.',
    };
  }

  switch (log.category) {
    case 'PRICE_DEVIATION': {
      const botPrice = log.details?.botPrice != null ? `$${Number(log.details.botPrice).toFixed(4)}` : '';
      const exchPrice = log.details?.exchangePrice != null ? `$${Number(log.details.exchangePrice).toFixed(4)}` : '';
      const dev = log.deviation != null ? `${Number(log.deviation).toFixed(4)}%` : '';
      return {
        title: `Desvio de preço na entrada`,
        detail: botPrice && exchPrice ? `Bot: ${botPrice} → Exchange: ${exchPrice} (${dev} de desvio)` : log.message,
      };
    }
    case 'SLIPPAGE': {
      const type = log.details?.type || '';
      const botPrice = log.details?.botPrice != null ? `$${Number(log.details.botPrice).toFixed(4)}` : '';
      const exchPrice = log.details?.exchangePrice != null ? `$${Number(log.details.exchangePrice).toFixed(4)}` : '';
      const dev = log.deviation != null ? `${Number(log.deviation).toFixed(4)}%` : '';
      const label = type === 'TAKE_PROFIT_1' ? 'TP1' : type === 'TAKE_PROFIT_2' ? 'TP2' : type === 'TAKE_PROFIT_3' ? 'TP3' : type ? String(type).replace(/_/g, ' ') : 'Execução';
      return {
        title: `Slippage em ${label}`,
        detail: botPrice && exchPrice ? `Bot: ${botPrice} → Exchange: ${exchPrice} (${dev})` : log.message,
      };
    }
    case 'PNL_MISMATCH': {
      const botPnl = log.details?.botPnl != null ? `$${Number(log.details.botPnl).toFixed(4)}` : '';
      const calcNet = log.details?.calculatedNet != null ? `$${Number(log.details.calculatedNet).toFixed(4)}` : '';
      const diff = log.deviation != null ? `$${Number(log.deviation).toFixed(4)}` : '';
      if (botPnl && calcNet) {
        return {
          title: `P&L divergente`,
          detail: `Bot registrou ${botPnl}, cálculo com taxas resulta em ${calcNet} (diferença: ${diff})`,
        };
      }
      if (log.details?.execPnlSum != null) {
        return {
          title: `Soma de execuções difere do total`,
          detail: `Soma das execuções: $${Number(log.details.execPnlSum).toFixed(4)}, Total do trade: $${Number(log.details.tradePnl).toFixed(4)}`,
        };
      }
      if (log.message.includes('sem preco de saida')) {
        return { title: 'Trade fechado sem preço de saída', detail: 'O trade foi marcado como fechado mas não tem preço de saída registrado.' };
      }
      return { title: catLabel, detail: log.message };
    }
    case 'SIGNAL_LATENCY': {
      const ms = log.deviation != null ? Number(log.deviation) : null;
      if (ms !== null) {
        const formatted = ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
        return {
          title: `Latência do sinal: ${formatted}`,
          detail: `Tempo entre o webhook e a execução da ordem na exchange.${ms > 30000 ? ' Valor alto — verifique a conectividade.' : ''}`,
        };
      }
      return { title: catLabel, detail: log.message };
    }
    case 'MISSED_FILL': {
      const expected = log.details?.expected != null ? Number(log.details.expected) : null;
      const filled = log.details?.filled != null ? Number(log.details.filled) : null;
      if (expected !== null && filled !== null) {
        const pct = ((filled / expected) * 100).toFixed(1);
        return {
          title: `Fill parcial (${pct}% preenchido)`,
          detail: `Esperado: ${expected}, Executado: ${filled}`,
        };
      }
      if (log.message.includes('nao preenchida')) {
        return { title: 'Ordem de entrada não preenchida', detail: log.message };
      }
      return { title: catLabel, detail: log.message };
    }
    case 'ORDER_REJECTED': {
      if (log.message.includes('nao encontrada')) {
        return {
          title: 'Ordem não encontrada na exchange',
          detail: `A ordem ${log.details?.orderId || ''} não foi localizada. Pode ter sido cancelada ou expirada.`,
        };
      }
      if (log.message.includes('com erro')) {
        return { title: 'Trade com erro', detail: String(log.details?.error || log.message) };
      }
      return { title: catLabel, detail: log.message };
    }
    default:
      return { title: catLabel, detail: log.message };
  }
}

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
    const effective = issues.map(getEffectiveSeverity);
    if (effective.includes('CRITICAL')) return 'CRITICAL';
    if (effective.includes('ERROR')) return 'ERROR';
    if (effective.includes('WARNING')) return 'WARNING';
    return 'INFO';
  };

  const countRealIssues = (issues: AuditLog[]) =>
    issues.filter(i => !isKnownLimitation(i) && (i.severity === 'ERROR' || i.severity === 'CRITICAL' || i.severity === 'WARNING')).length;

  const totalRealIssues = logs.filter(l => !isKnownLimitation(l) && (l.severity === 'ERROR' || l.severity === 'CRITICAL')).length;
  const totalWarnings = logs.filter(l => !isKnownLimitation(l) && l.severity === 'WARNING').length;
  const totalKnown = logs.filter(l => isKnownLimitation(l)).length;

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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="glass-card rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Total de Logs</div>
            <div className="text-lg font-bold font-mono text-foreground">{summary.total}</div>
          </div>
          <div className="glass-card rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Erros Reais</div>
            <div className={`text-lg font-bold font-mono ${totalRealIssues > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {totalRealIssues}
            </div>
            {totalRealIssues === 0 && <div className="text-[10px] text-emerald-400/60">Tudo OK</div>}
          </div>
          <div className="glass-card rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Avisos</div>
            <div className={`text-lg font-bold font-mono ${totalWarnings > 0 ? 'text-yellow-400' : 'text-foreground/60'}`}>
              {totalWarnings}
            </div>
          </div>
          <div className="glass-card rounded-lg p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Notas Informativas</div>
            <div className="text-lg font-bold font-mono text-blue-400/70">{totalKnown}</div>
            <div className="text-[10px] text-muted-foreground/50">Limitações conhecidas</div>
          </div>
        </div>
      )}

      {summary && summary.byCategory.length > 0 && (
        <div className="glass-card rounded-lg p-4">
          <h3 className="text-[10px] font-semibold mb-2.5 text-muted-foreground uppercase tracking-wider">Filtrar por Categoria</h3>
          <div className="flex flex-wrap gap-1.5">
            {summary.byCategory.map((c) => {
              const cat = CATEGORY_INFO[c.category];
              return (
                <button
                  key={c.category}
                  onClick={() => setFilterCategory(filterCategory === c.category ? '' : c.category)}
                  title={cat?.description}
                  className={`px-2.5 py-1.5 rounded-md text-[10px] font-medium transition border ${
                    filterCategory === c.category
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-secondary/60 border-border/40 text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
                >
                  <span className="mr-1">{cat?.icon || '•'}</span>
                  {cat?.label || c.category}: <span className="font-bold ml-0.5">{c.count}</span>
                </button>
              );
            })}
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
          Histórico ({logs.length})
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
              <option value="WARNING">Aviso</option>
              <option value="ERROR">Erro</option>
              <option value="CRITICAL">Crítico</option>
            </select>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-secondary/80 border border-border/40 rounded-md px-2 py-1.5 text-[10px] text-foreground focus:border-primary/50 outline-none"
            >
              <option value="">Todas Categorias</option>
              {Object.entries(CATEGORY_INFO).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
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
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{logs.length} registros</span>
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
              Object.entries(groupedLogs).map(([tradeId, tradeLogs]) => {
                const worst = worstSeverity(tradeLogs);
                const realCount = countRealIssues(tradeLogs);
                const knownCount = tradeLogs.filter(isKnownLimitation).length;
                const sev = SEVERITY_STYLES[worst] || SEVERITY_STYLES.INFO;

                return (
                  <div key={tradeId} className="border-b border-border/30 last:border-b-0">
                    <button
                      onClick={() => setExpandedTrade(expandedTrade === tradeId ? null : tradeId)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition text-left"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sev.dot}`} />
                      <span className="text-[10px] font-mono text-muted-foreground/60 w-20 flex-shrink-0 truncate" title={tradeId}>
                        {tradeId === 'general' ? 'Geral' : tradeId.slice(0, 8) + '...'}
                      </span>
                      <div className="flex-1 flex items-center gap-2 min-w-0 flex-wrap">
                        {realCount > 0 ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${sev.bg} ${sev.text} ${sev.border}`}>
                            {realCount} {realCount === 1 ? 'problema' : 'problemas'}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                            OK
                          </span>
                        )}
                        {knownCount > 0 && (
                          <span className="px-2 py-0.5 rounded text-[10px] border bg-blue-500/5 text-blue-400/60 border-blue-500/15">
                            {knownCount} {knownCount === 1 ? 'nota' : 'notas'}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground/50 font-mono flex-shrink-0 hidden sm:inline">
                        {new Date(tradeLogs[0].createdAt).toLocaleDateString()}
                      </span>
                      <ChevronIcon open={expandedTrade === tradeId} />
                    </button>

                    {expandedTrade === tradeId && (
                      <div className="bg-secondary/5 border-t border-border/20 px-4 py-3 space-y-2">
                        {tradeLogs.map((log) => {
                          const known = isKnownLimitation(log);
                          const effSev = getEffectiveSeverity(log);
                          const style = SEVERITY_STYLES[effSev] || SEVERITY_STYLES.INFO;
                          const parsed = parseIssueMessage(log);

                          return (
                            <div
                              key={log.id}
                              className={`rounded-lg border p-3 ${known ? 'bg-blue-500/5 border-blue-500/10' : `${style.bg} ${style.border}`}`}
                            >
                              <div className="flex items-start gap-2.5">
                                <span className={`mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${style.bg} ${style.text} ${style.border}`}>
                                  {known ? 'NOTA' : SEVERITY_LABELS[log.severity] || log.severity}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-xs font-medium ${known ? 'text-blue-400/80' : style.text} mb-0.5`}>
                                    {parsed.title}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground/80 leading-relaxed">
                                    {parsed.detail}
                                  </div>
                                  {log.deviation !== null && !known && (
                                    <div className="mt-2 flex items-center gap-3 text-[10px]">
                                      {log.expectedValue !== null && (
                                        <span className="text-muted-foreground/60">
                                          Esperado: <span className="font-mono text-emerald-400/80">{formatNum(Number(log.expectedValue))}</span>
                                        </span>
                                      )}
                                      {log.actualValue !== null && (
                                        <span className="text-muted-foreground/60">
                                          Real: <span className="font-mono text-yellow-400/80">{formatNum(Number(log.actualValue))}</span>
                                        </span>
                                      )}
                                      <span className="text-muted-foreground/60">
                                        Desvio: <span className={`font-mono ${Math.abs(Number(log.deviation)) > 1 ? 'text-red-400' : 'text-yellow-400/80'}`}>
                                          {formatNum(Number(log.deviation))}
                                        </span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <span className="text-[9px] text-muted-foreground/30 font-mono flex-shrink-0 hidden sm:inline">
                                  {CATEGORY_INFO[log.category]?.icon || '•'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
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
                <div className="glass-card rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">Trades Auditados</div>
                  <div className="text-lg font-bold font-mono text-foreground">{reconcileResult.tradesAudited}</div>
                </div>
                <div className="glass-card rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">Problemas</div>
                  <div className={`text-lg font-bold font-mono ${reconcileResult.totalIssues > 0 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {reconcileResult.totalIssues}
                  </div>
                  {reconcileResult.totalIssues === 0 && <div className="text-[10px] text-emerald-400/60">Tudo limpo</div>}
                </div>
                <div className="glass-card rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">Slippage Médio</div>
                  <div className={`text-lg font-bold font-mono ${reconcileResult.avgSlippagePct > 0.1 ? 'text-yellow-400' : 'text-foreground/80'}`}>
                    {reconcileResult.avgSlippagePct.toFixed(4)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground/50">{reconcileResult.avgSlippagePct <= 0.1 ? 'Normal' : 'Acima do esperado'}</div>
                </div>
                <div className="glass-card rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">Latência Média</div>
                  <div className={`text-lg font-bold font-mono ${reconcileResult.avgSignalLatencyMs > 5000 ? 'text-yellow-400' : 'text-foreground/80'}`}>
                    {reconcileResult.avgSignalLatencyMs >= 1000
                      ? `${(reconcileResult.avgSignalLatencyMs / 1000).toFixed(1)}s`
                      : `${reconcileResult.avgSignalLatencyMs.toFixed(0)}ms`}
                  </div>
                  <div className="text-[10px] text-muted-foreground/50">webhook → execução</div>
                </div>
                <div className="glass-card rounded-lg p-3">
                  <div className="text-[10px] text-muted-foreground mb-1">Taxas Exchange</div>
                  <div className="text-lg font-bold font-mono text-yellow-400/80">
                    ${reconcileResult.totalFeesNotAccountedFor.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground/50">Não descontadas do P&L</div>
                </div>
              </div>

              <div className="glass-card rounded-lg">
                <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Resultado por Trade</h3>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> OK</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Avisos</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Erros</span>
                  </div>
                </div>
                <div className="max-h-[600px] overflow-auto scrollbar-thin">
                  {reconcileResult.trades.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-xs">Nenhum trade fechado encontrado</div>
                  ) : (
                    reconcileResult.trades.map((tr) => {
                      const hasRealIssues = tr.issues.filter(i => !isKnownLimitation(i)).length;
                      const hasErrors = tr.issues.some(i => !isKnownLimitation(i) && (i.severity === 'ERROR' || i.severity === 'CRITICAL'));
                      const statusDot = hasErrors ? 'bg-red-400' : hasRealIssues > 0 ? 'bg-yellow-400' : 'bg-emerald-400';
                      const statusLabel = hasErrors ? 'Erro' : hasRealIssues > 0 ? `${hasRealIssues} aviso${hasRealIssues > 1 ? 's' : ''}` : 'OK';

                      return (
                        <div key={tr.tradeId} className="border-b border-border/30 last:border-b-0">
                          <button
                            onClick={() => setExpandedTrade(expandedTrade === `rec-${tr.tradeId}` ? null : `rec-${tr.tradeId}`)}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/20 transition text-left"
                          >
                            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot}`} />

                            <div className="flex items-center gap-3 flex-1 text-[11px] flex-wrap min-w-0">
                              <span className="font-mono text-muted-foreground/60 w-16 flex-shrink-0">{tr.tradeId.slice(0, 8)}...</span>
                              <span className="font-mono text-foreground/80">
                                {formatNum(tr.botData.entryPrice)}
                                {tr.botData.exitPrice !== null && (
                                  <span className="text-muted-foreground/40"> → </span>
                                )}
                                {tr.botData.exitPrice !== null && formatNum(tr.botData.exitPrice)}
                              </span>
                              {tr.botData.pnl !== null && (
                                <span className={`font-mono font-semibold ${tr.botData.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {tr.botData.pnl >= 0 ? '+' : ''}{tr.botData.pnl.toFixed(2)} USDT
                                </span>
                              )}
                            </div>

                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex-shrink-0 ${
                              hasErrors
                                ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                : hasRealIssues > 0
                                ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            }`}>
                              {statusLabel}
                            </span>
                            <ChevronIcon open={expandedTrade === `rec-${tr.tradeId}`} />
                          </button>

                          {expandedTrade === `rec-${tr.tradeId}` && (
                            <div className="bg-secondary/5 border-t border-border/20 px-4 py-4 space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <DetailBox title="Dados do Bot">
                                  <div className="grid grid-cols-2 gap-3 text-[11px]">
                                    <KV label="Entrada" value={`$${tr.botData.entryPrice.toFixed(4)}`} />
                                    <KV label="Saída" value={tr.botData.exitPrice !== null ? `$${tr.botData.exitPrice.toFixed(4)}` : '-'} />
                                    <KV label="Quantidade" value={String(tr.botData.quantity)} />
                                    <KV label="P&L" value={tr.botData.pnl !== null ? `$${tr.botData.pnl.toFixed(4)}` : '-'} valueColor={(tr.botData.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                                  </div>
                                </DetailBox>
                                <DetailBox title="Dados da Exchange">
                                  {tr.exchangeData ? (
                                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                                      <KV label="Preço Médio" value={`$${tr.exchangeData.avgPrice.toFixed(4)}`} />
                                      <KV label="Qty Executada" value={String(tr.exchangeData.executedQty)} />
                                      <KV label="Comissão" value={`$${tr.exchangeData.commission.toFixed(4)}`} valueColor="text-yellow-400" />
                                      <KV label="Status" value={tr.exchangeData.status === 'closed' || tr.exchangeData.status === 'FILLED' ? 'Preenchida' : tr.exchangeData.status} valueColor={tr.exchangeData.status === 'closed' || tr.exchangeData.status === 'FILLED' ? 'text-emerald-400' : 'text-yellow-400'} />
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-muted-foreground/60">Dados da exchange indisponíveis</div>
                                  )}
                                </DetailBox>
                              </div>

                              <DetailBox title="Métricas do Auditor">
                                <div className="flex flex-wrap gap-4 text-[11px]">
                                  {tr.calculatedPnl !== null && (
                                    <KV label="P&L Calculado" value={`$${tr.calculatedPnl.toFixed(4)}`} valueColor={tr.calculatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'} />
                                  )}
                                  <KV label="Taxas Exchange" value={`$${tr.feesFromExchange.toFixed(4)}`} valueColor="text-yellow-400/80" />
                                  {tr.slippage !== null && (
                                    <KV label="Slippage" value={`${tr.slippage.toFixed(4)}%`} valueColor={tr.slippage > 0.1 ? 'text-yellow-400' : 'text-foreground/60'} />
                                  )}
                                  {tr.signalLatencyMs !== null && (
                                    <KV label="Latência" value={tr.signalLatencyMs >= 1000 ? `${(tr.signalLatencyMs / 1000).toFixed(1)}s` : `${tr.signalLatencyMs}ms`} valueColor={tr.signalLatencyMs > 5000 ? 'text-yellow-400' : 'text-foreground/60'} />
                                  )}
                                </div>
                              </DetailBox>

                              {tr.issues.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-1">Detalhes</div>
                                  {tr.issues.map((issue, idx) => {
                                    const known = isKnownLimitation(issue);
                                    const effSev = getEffectiveSeverity(issue);
                                    const style = SEVERITY_STYLES[effSev] || SEVERITY_STYLES.INFO;
                                    const parsed = parseIssueMessage(issue);

                                    return (
                                      <div key={idx} className={`rounded-md border p-2.5 ${known ? 'bg-blue-500/5 border-blue-500/10' : `${style.bg} ${style.border}`}`}>
                                        <div className="flex items-start gap-2">
                                          <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${style.bg} ${style.text} ${style.border}`}>
                                            {known ? 'NOTA' : SEVERITY_LABELS[issue.severity] || issue.severity}
                                          </span>
                                          <div className="min-w-0">
                                            <div className={`text-[11px] font-medium ${known ? 'text-blue-400/70' : style.text}`}>{parsed.title}</div>
                                            <div className="text-[10px] text-muted-foreground/70 mt-0.5">{parsed.detail}</div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {tr.issues.length === 0 && (
                                <div className="text-[11px] text-emerald-400/60 text-center py-2 bg-emerald-500/5 rounded-md border border-emerald-500/10">
                                  Nenhum problema encontrado neste trade
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
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

function DetailBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-secondary/20 rounded-lg border border-border/20 p-3">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mb-2 font-medium">{title}</div>
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
      className={`text-muted-foreground/40 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
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
