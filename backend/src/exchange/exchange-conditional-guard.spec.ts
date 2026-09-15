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
const BASELINE: Record<string, number> = {
  'admin/admin.service.ts': 2,
  'binance-ws/binance-ws-init.service.ts': 1,
  'common/symbol-rules.service.ts': 3,
  'portfolios/portfolio.entity.ts': 1,
  'portfolios/portfolios.service.ts': 5,
  'position-sync/position-sync.service.ts': 7,
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
