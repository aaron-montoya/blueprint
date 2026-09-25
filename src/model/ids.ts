/** Short random ids, e.g. "p_k3f9x2ab". Unique enough for one diagram. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}${Date.now().toString(36).slice(-3)}`;
}
