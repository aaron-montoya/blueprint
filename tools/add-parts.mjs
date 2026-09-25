#!/usr/bin/env node
/**
 * Promote parts from an exported parts file (sidebar ⤓ or "Export mine")
 * into the built-in library: src/library/added-parts.json.
 *
 *   npm run add-parts -- ~/Downloads/Custom-parts.parts.json
 *   npm run add-parts -- file.parts.json --only "Test Sensor" --only "Other Part"
 *
 * A part whose id is already in added-parts.json is replaced (so re-running
 * with an updated export updates the part). Run `npm test` afterwards: it
 * validates every built-in part.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADDED = path.join(root, 'src/library/added-parts.json');
const GENERATED = path.join(root, 'src/library/default-library.json');

const args = process.argv.slice(2);
const only = [];
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--only') only.push(args[++i]);
  else files.push(args[i]);
}
if (!files.length) {
  console.error('usage: npm run add-parts -- <exported .parts.json> [--only "Part name"]...');
  process.exit(1);
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
process.on('uncaughtException', (e) => {
  console.error(`add-parts: ${e.message}`);
  process.exit(1);
});
const added = read(ADDED);
const generatedIds = new Set(read(GENERATED).parts.map((p) => p.id));

let changed = 0;
for (const file of files) {
  const lib = read(file);
  const parts = Array.isArray(lib) ? lib : lib.parts;
  if (!Array.isArray(parts)) throw new Error(`${file}: not a parts library file (no "parts" list)`);
  for (const part of parts) {
    if (only.length && !only.includes(part.name)) continue;
    if (!part.id || !part.name || !Array.isArray(part.pins)) throw new Error(`${file}: "${part.name ?? part.id}" is not a valid part`);
    if (generatedIds.has(part.id))
      throw new Error(`"${part.name}" has id "${part.id}", which a generated part already uses. Change its id first.`);
    const i = added.parts.findIndex((p) => p.id === part.id);
    if (i >= 0) {
      added.parts[i] = part;
      console.log(`updated  ${part.name}  (${part.category})`);
    } else {
      added.parts.push(part);
      console.log(`added    ${part.name}  (${part.category})`);
    }
    changed++;
  }
}
if (only.length && !changed) throw new Error(`none of ${only.map((n) => `"${n}"`).join(', ')} found`);
fs.writeFileSync(ADDED, JSON.stringify(added, null, 1) + '\n');
console.log(`${changed} part(s) written to src/library/added-parts.json — now run: npm test`);
