import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// PLANO_FIX_ORDEM_OKX_NA_BINANCE FASE 5: o guard de exchangeFactory.get(Exchange.
// <LITERAL>) (exchange-conditional-guard.spec.ts) nao pega este padrao -- aqui nao
// ha chamada ao factory, e uma chamada direta a um metodo cujo NOME ja e
// especifico de uma corretora (executeBinanceOrder, createBinanceStopLossOrder,
// etc.). Foi exatamente esse padrao que mandou ordem/SL/TP de uma estrategia OKX
// para a Binance: o "else" que deveria ser generico chamava um desses metodos
// diretamente, sem nenhum `if (exchange === Exchange.BINANCE)` protegendo.
//
// Este teste usa o compilador TypeScript para achar toda chamada a um desses
// metodos e verificar que ela esta dentro do ramo THEN de um
// `if (exchange === Exchange.BINANCE)` (ou equivalente) ancestral -- ou dentro de
// um metodo cujo unico call site ja e gated (ver ALLOWLISTED_HELPER_METHODS,
// cada entrada revisada individualmente).
const BINANCE_SPECIFIC_METHODS = [
  'executeBinanceOrder',
  'configureBinancePositionSettings',
  'createBinanceStopLossOrder',
  'createBinanceTakeProfitOrder',
];

// scheduleProtectionOrders: helper exclusivo de LIMIT orders na Binance, com um
// unico call site em _processSignalInternal, ja gated por
// `if (exchange === Exchange.BINANCE) { this.scheduleProtectionOrders(...) }`.
// A funcao nao repete a checagem internamente porque nunca e chamada fora desse
// site -- revisado manualmente, nao uma chamada de corretora errada.
const ALLOWLISTED_HELPER_METHODS = new Set(['scheduleProtectionOrders']);

function isBinanceLiteralCheck(node: ts.Expression, sourceFile: ts.SourceFile): boolean {
  const text = node.getText(sourceFile);
  return /Exchange\.BINANCE/.test(text) && /===|==/.test(text);
}

function findEnclosingMethodName(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isMethodDeclaration(current) && current.name) {
      return current.name.getText(sourceFile);
    }
    current = current.parent;
  }
  return null;
}

function isGuardedByBinanceCheck(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = current.parent;

  while (parent) {
    if (ts.isIfStatement(parent)) {
      const withinThen = isDescendantOf(current, parent.thenStatement);
      if (withinThen && isBinanceLiteralCheck(parent.expression, sourceFile)) {
        return true;
      }
    }
    current = parent;
    parent = parent.parent;
  }
  return false;
}

function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

describe('PLANO_FIX_ORDEM_OKX_NA_BINANCE FASE 5: guarda contra chamada a metodo especifico de corretora fora de bloco filtrado', () => {
  it('toda chamada a executeBinanceOrder/configureBinancePositionSettings/createBinanceStopLossOrder/createBinanceTakeProfitOrder esta dentro de um if (exchange === Exchange.BINANCE), ou em um helper cujo unico call site ja e gated (allowlist revisada)', () => {
    const filePath = path.join(__dirname, 'webhook.service.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

    const violations: string[] = [];

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        BINANCE_SPECIFIC_METHODS.includes(node.expression.name.text)
      ) {
        const methodName = node.expression.name.text;
        const enclosingMethod = findEnclosingMethodName(node, sourceFile);
        const guarded = isGuardedByBinanceCheck(node, sourceFile) ||
          (enclosingMethod !== null && ALLOWLISTED_HELPER_METHODS.has(enclosingMethod));

        if (!guarded) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push(
            `webhook.service.ts:${line + 1} -- chamada a this.${methodName}() fora de um if (exchange === Exchange.BINANCE) ` +
            `e fora da allowlist de helpers (enclosing method: ${enclosingMethod ?? 'desconhecido'})`,
          );
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    expect(violations).toEqual([]);
  });
});
