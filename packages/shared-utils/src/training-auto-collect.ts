import type { RedisClientType } from 'redis';

function hashToUnitInterval(hashHex: string): number {
  const normalized = hashHex.trim().toLowerCase();
  const chunk = normalized.slice(0, 13); // 52 bits em hex (~13 chars)
  const value = Number.parseInt(chunk, 16);
  if (!Number.isFinite(value) || value < 0) return 0;
  const max = Number.parseInt('fffffffffffff', 16);
  return value / max;
}

export function deterministicSample(semhash: string, rate: number): boolean {
  const safeRate = Math.min(1, Math.max(0, rate));
  if (safeRate <= 0) return false;
  if (safeRate >= 1) return true;
  return hashToUnitInterval(semhash) <= safeRate;
}

export function buildDailyCapKey(params: {
  tenantId: string;
  namespaceId?: string;
  userId?: string;
  dateISO: string;
}): string {
  const date = params.dateISO.slice(0, 10);
  const scope = [
    `tenant:${params.tenantId}`,
    params.namespaceId ? `namespace:${params.namespaceId}` : null,
    params.userId ? `user:${params.userId}` : null,
    `date:${date}`,
  ].filter(Boolean).join(':');
  return `training:auto-collect:cap:${scope}`;
}

export async function incrementWithDailyCap(
  redis: RedisClientType,
  key: string,
  cap: number
): Promise<{ allowed: boolean; current: number }> {
  const effectiveCap = Math.max(1, Math.trunc(cap));
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, 86_400);
  }
  return {
    allowed: current <= effectiveCap,
    current,
  };
}
