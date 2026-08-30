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

describe('precision regression guard', () => {
  it('nenhum toFixed(N) de casas fixas dentro de params.append(, qty: ou price: em todo o src/', () => {
    const srcDir = path.join(__dirname, '..');
    const files = walk(srcDir);
    const violations: string[] = [];
    const dangerousToFixed = /\.toFixed\(\d+\)/;

    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, idx) => {
        if (!dangerousToFixed.test(line)) return;

        const hasParamsAppend = /params\.append\(/.test(line);
        const hasQtyKey = /\bqty\s*:/.test(line);
        const hasPriceKey = /\bprice\s*:/.test(line);

        if (hasParamsAppend || hasQtyKey || hasPriceKey) {
          violations.push(`${path.relative(srcDir, file)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
