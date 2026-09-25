import fs from 'node:fs';
import path from 'node:path';
import { validateDiagram, validateLibrary } from '../model/format';

const dir = path.resolve(__dirname, '../../examples');

describe('example files', () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.blueprint'));
  it('has at least one example', () => expect(files.length).toBeGreaterThan(0));
  it.each(files)('%s is a valid, made-up diagram', (f) => {
    const d = validateDiagram(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(d.title.room.toLowerCase()).toContain('example');
  });
  it('the built-in library file validates', () => {
    const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../library/default-library.json'), 'utf8'));
    expect(validateLibrary(raw).parts.length).toBeGreaterThan(60);
  });
});
