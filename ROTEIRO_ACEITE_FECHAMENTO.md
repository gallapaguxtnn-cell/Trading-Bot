# Roteiro de aceite — AUDITORIA_E_FECHAMENTO (FASE 4)

Cada item do checklist original (`AUDITORIA_E_FECHAMENTO.md`, seção 3) mapeado para o teste
automatizado que prova o comportamento, ou para o passo manual quando o item só pode ser
verificado contra uma conta Bybit real (fora do alcance de um teste automatizado).

| # | Critério | Como está provado |
|---|---|---|
| 1 | Dois portfólios Bybit de entidades diferentes operando ao mesmo tempo, sem "API key is invalid" | `backend/src/common/dual-portfolio-siteid.acceptance.spec.ts` — resolve credenciais de um portfólio `BRA_BTL` e de um portfólio padrão em paralelo e confirma que as chamadas HTTP simultâneas levam `x-site-id` independentes (uma com `BRA_BTL`, a outra sem o header), sem vazamento entre elas. **Manual**: cadastrar as duas contas reais em `/portfolios`, rodar uma estratégia em cada e confirmar nos logs que nenhuma recebe retCode 10003. |
| 2 | Ordem com buffer que preenche horas depois: SL efetivo = 2% sobre o preço de preenchimento | `backend/src/webhook/webhook.service.spec.ts` → describe `FASE 2 -- reposicionar SL/TP desalinhado no fill monitor Bybit`, teste `SL desalinhado (caso real SUIUSDT: SL 0.8015 vs alvo 0.81192 sobre o fill 0.796)`: fill real 0.796, `stopLossPercentage=2`, o SL recriado é `0.8119` (2% sobre o fill, não sobre o preço do sinal). |
| 3 | PnL do card idêntico ao `Closed P&L` da Bybit | `backend/src/stop-loss/stop-loss.service.spec.ts` (FASE 4 — PnL do SL lido da corretora) e `backend/src/take-profit/take-profit.service.spec.ts`: PnL sempre lido de `fetchOrderFill`/`tpPnl` sobre o fill real retornado pela corretora, nunca calculado localmente quando o fill está disponível. |
| 4 | Card mostra tempo pendente e tempo em posição separados | `frontend/components/trades/TradeCard.tsx` — campo "Em posição" (desde `filledAt`) e sub-linha "Pendente: Xh Ym" (desde `timestamp` até `filledAt`, só para LIMIT). Sem framework de teste de componente no frontend; validado via `tsc --noEmit` + `eslint` limpos e via os dados que alimentam a UI (`signalPrice`/`filledAt`) cobertos em `webhook.service.spec.ts`. **Manual**: abrir um trade LIMIT com buffer no dashboard e conferir os dois tempos exibidos. |
| 5 | `dryRun` do reset lista ordens vivas na corretora; reset recusa enquanto existirem | `backend/src/admin/admin.service.spec.ts`: `dryRun inclui liveOrders...`, `reset real com ordem New na corretora -- RECUSA...`, `reset real com cancelOrphanOrders=true: cancela a ordem viva...`. |
| 6 | Auditoria sem `SL_PERCENT_MISMATCH`, `TP_PERCENT_MISMATCH` nem `MISSING_TP_ORDERS` nos trades novos | Consequência de (2): SL/TP calculados sobre o fill real (não mais sobre o sinal) elimina a causa raiz desses três achados. Regras testadas isoladamente em `backend/src/auditor/percent-mismatch.util.spec.ts`. **Manual**: rodar `/auditor` após alguns trades novos e confirmar ausência desses três tipos. |

## Rodando a suíte completa

```bash
cd backend && npm test && npm run build
cd ../frontend && npm run build
```

Estado neste commit: 45 suites / 337 testes verdes no backend, build limpo em backend e frontend.
