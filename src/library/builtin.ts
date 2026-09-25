import generated from './default-library.json';
import added from './added-parts.json';
import { validateLibrary, type PartDefinition, type PartsLibraryFile } from '../model/format';

/**
 * The built-in parts, from two files:
 *  - default-library.json: generated from tools/eit_parts_library_build.py
 *    (`npm run library`), never edited by hand;
 *  - added-parts.json: parts made in the Part Maker and promoted to the
 *    built-in list (`npm run add-parts -- <exported .parts.json>`).
 * The converter never touches added-parts.json, so promoted parts survive
 * regenerating the library.
 */
const GENERATED: PartsLibraryFile = validateLibrary(generated);
const ADDED: PartsLibraryFile = validateLibrary(added);

export const GENERATED_PARTS: PartDefinition[] = GENERATED.parts;
export const ADDED_PARTS: PartDefinition[] = ADDED.parts;
/**
 * Promoted parts are listed next to their relatives (e.g. JST 5-pin right
 * after JST 4-pin): after the last generated part in the same category whose
 * name starts with the same word. Otherwise at the end.
 */
function merge(generated: PartDefinition[], added: PartDefinition[]): PartDefinition[] {
  const out = [...generated];
  const firstWord = (p: PartDefinition) => p.name.split(/\s+/)[0].toLowerCase();
  for (const part of added) {
    let at = -1;
    out.forEach((p, i) => {
      if (p.category === part.category && firstWord(p) === firstWord(part)) at = i;
    });
    if (at >= 0) out.splice(at + 1, 0, part);
    else out.push(part);
  }
  return out;
}

export const BUILTIN_PARTS: PartDefinition[] = merge(GENERATED_PARTS, ADDED_PARTS);
export const BUILTIN_LIBRARY: PartsLibraryFile = { ...GENERATED, name: 'EIT built-in parts', parts: BUILTIN_PARTS };
