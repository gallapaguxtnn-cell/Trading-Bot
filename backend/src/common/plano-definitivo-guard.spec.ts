import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

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

function relFiles(srcDir: string): Array<{ file: string; content: string }> {
  return walk(srcDir).map((file) => ({
    file: path.relative(srcDir, file).split(path.sep).join('/'),
    content: fs.readFileSync(file, 'utf-8'),
  }));
}

// PLANO_DEFINITIVO_CORRETORAS FASE 6, item 1: so o CredentialsResolver e o
// PortfolioMigrationService podem ler os campos legados da Strategy
// (legacyExchange/legacyApiKey/legacyApiSecret/legacyIsTestnet/legacyIsRealAccount).
// strategy.entity.ts (onde as propriedades sao declaradas) e
// resolved-strategy.type.ts (Omit puramente de tipo, sem leitura em runtime)
// tambem sao estruturalmente necessarios e nao contam como violacao.
describe('PLANO_DEFINITIVO_CORRETORAS FASE 6: guarda contra leitura de campos legados fora do resolver/migracao', () => {
  it('nenhum arquivo de producao fora da allowlist referencia legacyExchange/legacyApiKey/legacyApiSecret/legacyIsTestnet/legacyIsRealAccount', () => {
    const srcDir = path.join(__dirname, '..');
    const pattern = /\blegacy(Exchange|ApiKey|ApiSecret|IsTestnet|IsRealAccount)\b/;
    const allowlist = new Set([
      'common/credentials-resolver.service.ts',
      'common/resolved-strategy.type.ts',
      'portfolios/portfolio-migration.service.ts',
      'strategies/strategy.entity.ts',
    ]);

    const violations = relFiles(srcDir)
      .filter(({ file }) => !allowlist.has(file))
      .filter(({ content }) => pattern.test(content))
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });
});

// PLANO_DEFINITIVO_CORRETORAS FASE 6, item 2: nenhuma assinatura de metodo de
// servico pode voltar a aceitar `strategy: any` -- o "any" foi o que escondeu
// o bug real do OKX em getCurrentPrice (take-profit.service.ts:811).
describe('PLANO_DEFINITIVO_CORRETORAS FASE 6: guarda contra strategy: any em assinatura de servico', () => {
  it('nenhum arquivo de producao declara um parametro strategy: any', () => {
    const srcDir = path.join(__dirname, '..');
    const pattern = /strategy\s*:\s*any\b/;

    const violations = relFiles(srcDir)
      .filter(({ content }) => pattern.test(content))
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });
});

// PLANO_DEFINITIVO_CORRETORAS FASE 6, item 4: um catch de nivel superior (o
// que envolve a tentativa inteira de fechar/recriar SL ou TP -- nao um
// try/catch aninhado em torno de um efeito colateral secundario, como gravar
// um registro de auditoria) que so loga e engole o erro reproduz o bug que a
// FASE 1 corrigiu: o estado nunca era persistido, entao o cron seguinte
// tentava de novo, indefinidamente. Cada catch de nivel superior precisa
// persistir o motivo da falha (.save/.update na tradesRepository,
// escalateImmediately, needsReconciliation), relançar o erro, ou devolver um
// valor de sinalizacao explicito que o chamador usa para decidir e persistir
// (ex.: recreateStopLoss devolve `false` e os dois call sites em
// checkStopLoss persistem o estado a partir disso).
function getTopLevelCatchClauses(sourceFile: ts.SourceFile, methodName: string): ts.CatchClause[] {
  let methodBody: ts.Block | undefined;

  function visit(node: ts.Node) {
    if (methodBody) return;
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      node.name.getText(sourceFile) === methodName &&
      node.body
    ) {
      methodBody = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (!methodBody) {
    throw new Error(`Method ${methodName} not found in ${sourceFile.fileName}`);
  }

  return methodBody.statements
    .filter((stmt): stmt is ts.TryStatement => ts.isTryStatement(stmt))
    .map((stmt) => stmt.catchClause)
    .filter((clause): clause is ts.CatchClause => !!clause);
}

const PERSISTENCE_MARKERS = /\.save\(|\.update\(|escalateImmediately|registerPositionCheckFailure|needsReconciliation|throw\s|return\s+\S/;
const LOGS = /this\.logger\.(error|warn)/;

const GUARDED_METHODS: Array<{ file: string; fn: string }> = [
  { file: 'stop-loss/stop-loss.service.ts', fn: 'closePosition' },
  { file: 'stop-loss/stop-loss.service.ts', fn: 'recreateStopLoss' },
  { file: 'take-profit/take-profit.service.ts', fn: 'closePosition' },
];

describe('PLANO_DEFINITIVO_CORRETORAS FASE 6: guarda contra catch de nivel superior em SL/TP que so loga sem persistir', () => {
  it.each(GUARDED_METHODS)('$file :: $fn -- o catch de nivel superior persiste o motivo da falha, relança, ou devolve sinal que o chamador persiste', ({ file, fn }) => {
    const srcDir = path.join(__dirname, '..');
    const filePath = path.join(srcDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const catchClauses = getTopLevelCatchClauses(sourceFile, fn);
    expect(catchClauses.length).toBeGreaterThan(0);

    const silentCatches = catchClauses
      .map((clause) => clause.block.getText(sourceFile))
      .filter((block) => LOGS.test(block) && !PERSISTENCE_MARKERS.test(block));

    expect(silentCatches).toEqual([]);
  });
});
