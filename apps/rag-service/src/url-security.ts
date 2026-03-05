import dns from 'node:dns/promises';
import net from 'node:net';

type LookupAddress = {
  address: string;
  family: number;
};

export type HostLookupFn = (hostname: string) => Promise<LookupAddress[]>;

function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function stripIpv6Zone(address: string): string {
  const zoneIndex = address.indexOf('%');
  if (zoneIndex === -1) return address;
  return address.slice(0, zoneIndex);
}

function normalizeIpv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return octets;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const octets = normalizeIpv4Octets(address);
  if (!octets) return true;

  const [a, b] = octets;

  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && octets[2] === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224) return true;

  return false;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = stripIpv6Zone(address).toLowerCase();
  if (normalized === '::') return true;
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('ff')) return true;
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    return isPrivateOrReservedIpv4(mappedIpv4);
  }
  return false;
}

export function isPrivateOrReservedIp(address: string): boolean {
  const family = net.isIP(stripIpv6Zone(address));
  if (family === 4) return isPrivateOrReservedIpv4(address);
  if (family === 6) return isPrivateOrReservedIpv6(address);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost') return true;
  if (normalized.endsWith('.localhost')) return true;
  if (normalized.endsWith('.local')) return true;
  if (normalized.endsWith('.internal')) return true;
  return false;
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  lookupHost: HostLookupFn = defaultLookup
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL invalida para crawl');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Somente protocolos http/https sao permitidos para crawl');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL com credenciais embutidas nao e permitida para crawl');
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('Hostname bloqueado para crawl');
  }

  const literalIpFamily = net.isIP(stripIpv6Zone(parsed.hostname));
  if (literalIpFamily > 0) {
    if (isPrivateOrReservedIp(parsed.hostname)) {
      throw new Error('Endereco IP privado/reservado bloqueado para crawl');
    }
    return parsed;
  }

  let resolvedAddresses: LookupAddress[];
  try {
    resolvedAddresses = await lookupHost(parsed.hostname);
  } catch {
    throw new Error('Falha ao resolver DNS da URL de crawl');
  }

  if (!resolvedAddresses.length) {
    throw new Error('Hostname sem resolucao DNS valida para crawl');
  }

  for (const item of resolvedAddresses) {
    if (!item.address || isPrivateOrReservedIp(item.address)) {
      throw new Error('Destino resolve para endereco privado/reservado; crawl bloqueado');
    }
  }

  return parsed;
}
