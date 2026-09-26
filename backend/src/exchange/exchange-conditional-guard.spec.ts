import * as fs from 'fs';
import * as path from 'path';

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Baseline capturado ao final da FASE 2 (PLANO_INTEGRACAO_OKX): numero de
// referencias a Exchange.BYBIT/BINANCE/OKX que ainda restam fora de
// src/exchange/ apos a migracao mecanica para o ExchangeClient neutro.
// Cada uma dessas referencias remanescentes e uma decisao de negocio
// genuinamente diferente por corretora (nao duplicacao de mecanica HTTP) e
// foi revisada individualmente durante a FASE 2 -- ver as mensagens de
// commit de cada arquivo para o raciocinio completo.
//
// Este teste e um ratchet: o numero por arquivo so pode DIMINUIR (ao migrar
// mais logica para dentro de src/exchange/), nunca aumentar. Se voce
// precisa de um comportamento diferente por corretora em um novo trecho de
// codigo, prefira estender a interface ExchangeClient (src/exchange/
// exchange-client.interface.ts) em vez de adicionar mais um
// `if (exchange === Exchange.BYBIT)` disperso pelo resto do backend.
// 'auditor/auditor.service.ts': 2 (PLANO_DEFINITIVO_CORRETORAS FASE 5) --
// getExchangeForStrategy() so suporta Binance/Bybit via CCXT; o guard e um
// capability-check que lanca erro explicito para qualquer outra corretora
// (nunca tenta usar o client errado), nao uma decisao de negocio duplicada.
// 'position-sync/position-sync.service.ts': 7 -> 8 (PLANO_FIX_ORDEM_OKX_NA_BINANCE
// FASE 3) -- fetchPositions() identifica se um 401 e causado por passphrase da
// OKX ausente (header OK-ACCESS-PASSPHRASE vazio) para dar uma mensagem de erro
// especifica em vez de "API Key invalida"; e diagnostico, nao roteamento.
// 'common/account-context.util.ts': 0 -> 1 -- toAccountContext() decripta a
// passphrase a partir do ResolvedCredentials e recusa contexto OKX sem ela
// (a OKX exige OK-ACCESS-PASSPHRASE em toda requisicao privada; sem o check,
// a falha aparecia so na corretora como 50104/401). E validacao de credencial
// obrigatoria da corretora, nao roteamento de logica de negocio.
const BASELINE: Record<string, number> = {
  'admin/admin.service.ts': 2,
  'auditor/auditor.service.ts': 2,
  'binance-ws/binance-ws-init.service.ts': 1,
  'common/account-context.util.ts': 1,
  'common/symbol-rules.service.ts': 3,
  'portfolios/portfolio.entity.ts': 1,
  'portfolios/portfolios.service.ts': 7,
  'position-sync/position-sync.service.ts': 8,
  'stop-loss/stop-loss.service.ts': 16,
  'strategies/strategies.service.ts': 3,
  'strategies/strategy.entity.ts': 1,
  'take-profit/take-profit.service.ts': 17,
  'trades/trades.controller.ts': 4,
  'webhook/webhook.service.ts': 40,
};

describe('exchange conditional guard (FASE 2 -- PLANO_INTEGRACAO_OKX)', () => {
  it('nenhuma referencia nova a Exchange.BYBIT/BINANCE/OKX fora de src/exchange/ alem do baseline pos-migracao', () => {
    const srcDir = path.join(__dirname, '..');
    const exchangeDir = path.join(__dirname);
    const pattern = /Exchange\.(BYBIT|BINANCE|OKX)\b/;

    const files = walk(srcDir).filter((file) => !file.startsWith(exchangeDir + path.sep));

    const counts: Record<string, number> = {};
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(new RegExp(pattern.source, 'g'));
      if (matches && matches.length > 0) {
        counts[path.relative(srcDir, file).split(path.sep).join('/')] = matches.length;
      }
    }

    const regressions: string[] = [];
    for (const [file, count] of Object.entries(counts)) {
      const allowed = BASELINE[file] ?? 0;
      if (count > allowed) {
        regressions.push(
          `${file}: ${count} referencia(s), baseline permite ${allowed}. ` +
          `Prefira estender ExchangeClient em vez de adicionar condicional de corretora aqui.`,
        );
      }
    }

    expect(regressions).toEqual([]);
  });
});

// Allowlist capturado ao final da FASE 2 (PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT).
// exchangeFactory.get(Exchange.<LITERAL>) fora de src/exchange/ e um padrao
// especificamente perigoso: se o literal nao bater com a corretora real da
// estrategia/portfolio que chamou a funcao, as credenciais de uma corretora
// vao para o client de outra (foi exatamente o bug do getAccountBalance --
// ver PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT.md). Cada ocorrencia abaixo foi
// revisada e so e segura porque esta dentro de um bloco/funcao ja gated pelo
// mesmo literal (ex.: `if (exchange === Exchange.BYBIT) { ...
// exchangeFactory.get(Exchange.BYBIT) ... }`) ou dentro de uma funcao nomeada
// e exclusiva daquela corretora (ex.: createBinanceStopLossOrder), sempre
// chamada a partir de um site tambem gated. Nunca adicione uma nova entrada
// aqui sem confirmar o gating -- prefira usar a corretora resolvida
// (`exchangeFactory.get(exchange)`) e so cair aqui se o comportamento for
// genuinamente exclusivo daquela corretora.
const FIXED_EXCHANGE_FACTORY_ALLOWLIST: Record<string, number> = {
  'portfolios/portfolios.service.ts': 1,
  'take-profit/take-profit.service.ts': 1,
  'webhook/webhook.service.ts': 10,
};

describe('exchange conditional guard (PLANO_FIX_BALANCE_OKX_FALLBACK_BYBIT -- FASE 2)', () => {
  it('exchangeFactory.get(Exchange.<LITERAL>) fora de src/exchange/ so aparece nas ocorrencias revisadas e permitidas na allowlist', () => {
    const srcDir = path.join(__dirname, '..');
    const exchangeDir = path.join(__dirname);
    const pattern = /exchangeFactory\.get\(Exchange\.(BYBIT|BINANCE|OKX)\)/g;

    const files = walk(srcDir).filter((file) => !file.startsWith(exchangeDir + path.sep));

    const counts: Record<string, number> = {};
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        counts[path.relative(srcDir, file).split(path.sep).join('/')] = matches.length;
      }
    }

    const regressions: string[] = [];
    for (const [file, count] of Object.entries(counts)) {
      const allowed = FIXED_EXCHANGE_FACTORY_ALLOWLIST[file] ?? 0;
      if (count > allowed) {
        regressions.push(
          `${file}: ${count} chamada(s) exchangeFactory.get(Exchange.<LITERAL>), allowlist permite ${allowed}. ` +
          `Use exchangeFactory.get(exchange) com a corretora resolvida da estrategia/portfolio, nunca um literal fixo -- ` +
          `foi exatamente assim que o saldo da OKX foi parar na Bybit.`,
        );
      }
    }

    expect(regressions).toEqual([]);
  });
});
