export function effectiveOrder<T extends string>(
  defaultProvider: T,
  primaryFallbackOrder: T[],
  reserveFallbackOrder: T[],
): T[] {
  const seen = new Set<T>();
  const order: T[] = [];
  const add = (p: T) => { if (!seen.has(p)) { seen.add(p); order.push(p); } };
  add(defaultProvider);
  for (const p of primaryFallbackOrder) add(p);
  for (const p of reserveFallbackOrder) add(p);
  return order;
}
