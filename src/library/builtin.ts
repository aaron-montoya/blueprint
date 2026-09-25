import raw from './default-library.json';
import { validateLibrary, type PartsLibraryFile } from '../model/format';

/** The built-in EIT parts, generated from tools/eit_parts_library_build.py. */
export const BUILTIN_LIBRARY: PartsLibraryFile = validateLibrary(raw);
export const BUILTIN_PARTS = BUILTIN_LIBRARY.parts;
