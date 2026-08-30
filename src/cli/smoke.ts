/**
 * Smoke-Test: laedt jedes Modul unter src/ (ausser den CLI-Entrypoints, die
 * beim Import ihr main() starten wuerden) und prueft, dass die drei externen
 * Runtime-Abhaengigkeiten funktional arbeiten.
 *
 * Faengt genau das ab, was ein Typecheck nicht sieht: fehlende Pakete,
 * kaputte Import-Pfade, Top-Level-Fehler beim Modulstart.
 *
 * Laeuft ohne Netzwerk. Aufruf: pnpm run smoke
 */
import 'dotenv/config';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(fileURLToPath(new URL('../', import.meta.url)));
const SKIP_DIRS = new Set(['cli']);

async function collect(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await collect(full)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const files = (await collect(SRC)).sort();
  let ok = 0;
  const failed: string[] = [];

  await Promise.all(
    files.map(async (file) => {
      try {
        await import(pathToFileURL(file).href);
        ok++;
      } catch (err) {
        failed.push(`${relative(SRC, file)}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      }
    }),
  );

  console.log(`Node ${process.version} — Module geladen: ${ok}, fehlgeschlagen: ${failed.length}`);
  for (const f of failed) console.error(`  FAIL ${f}`);

  // Funktionale Stichproben der externen Abhaengigkeiten
  const checks: [string, boolean, string][] = [];

  const { latLngToCell, cellToLatLng } = await import('h3-js');
  const cell = latLngToCell(15.8801, 108.338, 8);
  const [lat, lng] = cellToLatLng(cell);
  checks.push(['h3-js', cell === '884164308bfffff' && Math.abs(lat - 15.8801) < 0.05 && Math.abs(lng - 108.338) < 0.05, cell]);

  const { XMLParser } = await import('fast-xml-parser');
  const parsed = new XMLParser({ isArray: (_t, j) => j === 'urlset.url' }).parse(
    '<urlset><url><loc>https://a.test/1</loc></url><url><loc>https://a.test/2</loc></url></urlset>',
  );
  const locs = parsed.urlset.url.map((u: { loc: string }) => u.loc);
  checks.push(['fast-xml-parser', locs.length === 2 && locs[0] === 'https://a.test/1', locs.join(' ')]);

  const { createClient } = await import('@supabase/supabase-js');
  checks.push(['@supabase/supabase-js', typeof createClient === 'function', typeof createClient]);

  const { mapCategory, mapCategoryFromPrimaryType } = await import('../google-maps/category-mapper.js');
  checks.push([
    'category-mapper',
    mapCategory(undefined) === null && mapCategoryFromPrimaryType(undefined) === null && mapCategory(['cafe']) !== null,
    String(mapCategory(['cafe'])),
  ]);

  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? 'OK  ' : 'FAIL'} ${name.padEnd(24)} ${detail}`);
  }

  const allPass = failed.length === 0 && checks.every(([, p]) => p);
  console.log(allPass ? '\nSmoke-Test bestanden.' : '\nSmoke-Test FEHLGESCHLAGEN.');
  if (!allPass) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke-Test abgebrochen:', err);
  process.exit(1);
});
