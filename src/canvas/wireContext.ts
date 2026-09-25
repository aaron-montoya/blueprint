import { createContext, useContext } from 'react';
import type { WireGeometry } from '../geometry/wireGeometry';

export const WireGeometryContext = createContext<Map<string, WireGeometry>>(new Map());
export const useWireGeometry = (id: string) => useContext(WireGeometryContext).get(id);
