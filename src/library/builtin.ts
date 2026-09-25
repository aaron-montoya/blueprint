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
export const BUILTIN_PARTS: PartDefinition[] = [...GENERATED_PARTS, ...ADDED_PARTS];
export const BUILTIN_LIBRARY: PartsLibraryFile = { ...GENERATED, name: 'EIT built-in parts', parts: BUILTIN_PARTS };
