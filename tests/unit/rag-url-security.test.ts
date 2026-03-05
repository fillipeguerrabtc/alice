import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl, isPrivateOrReservedIp, type HostLookupFn } from '../../apps/rag-service/src/url-security';

describe('rag url security', () => {
  it('blocks non-http protocols', async () => {
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow(
      'Somente protocolos http/https sao permitidos para crawl'
    );
  });

  it('blocks embedded credentials', async () => {
    await expect(assertSafeOutboundUrl('https://user:pass@example.com')).rejects.toThrow(
      'URL com credenciais embutidas nao e permitida para crawl'
    );
  });

  it('blocks localhost hostnames', async () => {
    await expect(assertSafeOutboundUrl('http://localhost:8080')).rejects.toThrow(
      'Hostname bloqueado para crawl'
    );
  });

  it('blocks private literal ipv4', async () => {
    await expect(assertSafeOutboundUrl('http://10.0.0.2:8080')).rejects.toThrow(
      'Endereco IP privado/reservado bloqueado para crawl'
    );
  });

  it('blocks dns results that resolve to private ip', async () => {
    const lookup: HostLookupFn = async () => [{ address: '169.254.169.254', family: 4 }];
    await expect(assertSafeOutboundUrl('https://example.com', lookup)).rejects.toThrow(
      'Destino resolve para endereco privado/reservado; crawl bloqueado'
    );
  });

  it('accepts public resolved hosts', async () => {
    const lookup: HostLookupFn = async () => [{ address: '93.184.216.34', family: 4 }];
    const parsed = await assertSafeOutboundUrl('https://example.com/path', lookup);
    expect(parsed.hostname).toBe('example.com');
    expect(parsed.protocol).toBe('https:');
  });

  it('blocks mixed dns answers when one address is private', async () => {
    const lookup: HostLookupFn = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.10.10.10', family: 4 },
    ];
    await expect(assertSafeOutboundUrl('https://example.com', lookup)).rejects.toThrow(
      'Destino resolve para endereco privado/reservado; crawl bloqueado'
    );
  });

  it('classifies private and public ips correctly', () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
  });
});
