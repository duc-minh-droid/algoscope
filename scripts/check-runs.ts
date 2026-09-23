/**
 * Smoke-tests algorithm generators in Node: runs default input, every preset and 25 random inputs,
 * and validates each frame. Usage: npm run check [-- <id-or-path-substring> ...]
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCode } from '../src/core/code';
import type { AlgorithmDef } from '../src/core/types';

const root = join(import.meta.dirname, '..', 'src', 'algorithms');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.tsx') && !f.startsWith('_') ? [join(d, f)] : []));
const filters = process.argv.slice(2);
const files = walk(root).filter((f) => !filters.length || filters.some((q) => f.replace(/\\/g, '/').includes(q)));

let failed = 0;
const ids = new Set<string>();
for (const file of files) {
  const rel = relative(root, file);
  let def: AlgorithmDef;
  try {
    def = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    console.log(`✗ ${rel}: import failed — ${(e as Error).message}`);
    failed++;
    continue;
  }
  const errs: string[] = [];
  if (!def?.id) errs.push('no default export with an id');
  else {
    if (ids.has(def.id)) errs.push(`duplicate id ${def.id}`);
    ids.add(def.id);
    const tags = { js: new Set(parseCode(def.code.js).flatMap((l) => l.tags)), py: new Set(parseCode(def.code.py).flatMap((l) => l.tags)) };
    const inputs: [string, unknown][] = [['default', def.input.default], ...(def.input.presets ?? []).map((p) => [`preset "${p.name}"`, p.value] as [string, unknown])];
    for (let k = 0; k < 25 && def.input.random; k++) inputs.push([`random #${k}`, def.input.random()]);
    for (const [name, input] of inputs) {
      try {
        if (def.input.format && def.input.parse) {
          const round = def.input.parse(def.input.format(input as never));
          if (JSON.stringify(round) !== JSON.stringify(input)) errs.push(`${name}: parse(format(x)) doesn't round-trip`);
        }
        let n = 0;
        for (const f of def.run(input as never)) {
          n++;
          if (!f.note) errs.push(`${name}: frame ${n} has no note`);
          for (const t of f.line === undefined ? [] : Array.isArray(f.line) ? f.line : [f.line]) {
            if (!tags.js.has(t)) errs.push(`${name}: tag "${t}" missing in js code`);
            if (!tags.py.has(t)) errs.push(`${name}: tag "${t}" missing in py code`);
          }
          if (n > 2500) {
            errs.push(`${name}: more than 2500 frames`);
            break;
          }
        }
        if (n < 2) errs.push(`${name}: only ${n} frames`);
      } catch (e) {
        errs.push(`${name}: threw — ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
    }
  }
  const uniq = [...new Set(errs)];
  if (uniq.length) {
    failed++;
    console.log(`✗ ${rel}\n  - ${uniq.slice(0, 12).join('\n  - ')}`);
  } else console.log(`✓ ${rel} (${def.id})`);
}
console.log(failed ? `\n${failed} file(s) with problems` : `\nall ${files.length} ok`);
process.exit(failed ? 1 : 0);
