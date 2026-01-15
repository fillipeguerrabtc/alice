/**
 * OIDC JWKs Generator - Alice Enterprise Platform
 * Geração e gestão de chaves RS256 para assinatura de JWTs
 * 
 * Seguindo Regra 6 CLAUDE.md: Persistência em PostgreSQL (SEM in-memory!)
 * Seguindo Regra 42: JWT signing com RS256
 * Best Practices 2025: jose v6.1.2
 * 
 * @author Alice Team
 * @version 1.1.0
 */

import { generateKeyPair, exportJWK, type JWK } from 'jose';
import { getDatabase } from '@alice/database';
import { oidcJwks } from '@alice/shared/schema';
import { eq, desc } from '@alice/database';
import { createLogger } from '@alice/logger';
import crypto from 'crypto';

const logger = createLogger('oidc-jwks');

/**
 * Gerar novo par de chaves RSA para OIDC
 * RS256 (RSA Signature with SHA-256) - padrão recomendado para OIDC
 */
export async function generateRSAKeyPair(): Promise<{
  privateKey: JWK;
  publicKey: JWK;
  kid: string;
}> {
  // Gerar kid único baseado em hash do timestamp + random
  const kid = crypto
    .createHash('sha256')
    .update(`${Date.now()}-${crypto.randomBytes(16).toString('hex')}`)
    .digest('hex')
    .substring(0, 16);

  // Gerar par de chaves RSA (2048 bits - padrão seguro)
  // NOTA: extractable: true é OBRIGATÓRIO no Node.js 22+ para exportJWK funcionar
  // Sem isso, a Web Crypto API gera chaves não-exportáveis por padrão
  // REF: https://github.com/panva/jose/issues/623
  const { publicKey, privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });

  // Exportar como JWK
  const privateJwk = await exportJWK(privateKey);
  const publicJwk = await exportJWK(publicKey);

  // Adicionar metadados
  privateJwk.kid = kid;
  privateJwk.alg = 'RS256';
  privateJwk.use = 'sig';

  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';

  logger.info({ kid }, 'Novo par de chaves RSA gerado');

  return {
    privateKey: privateJwk,
    publicKey: publicJwk,
    kid,
  };
}

/**
 * Persistir chave no PostgreSQL (Regra 6 - sem in-memory storage)
 */
async function persistJWK(
  kid: string,
  privateKey: JWK,
  publicKey: JWK
): Promise<void> {
  const db = getDatabase();

  try {
    await db.insert(oidcJwks).values({
      kid,
      alg: 'RS256',
      use: 'sig',
      privateKey: privateKey as unknown as Record<string, unknown>,
      publicKey: publicKey as unknown as Record<string, unknown>,
      ativo: true,
    });

    logger.info({ kid }, 'Chave JWKS persistida no PostgreSQL');
  } catch (error) {
    logger.error({ error, kid }, 'Erro ao persistir chave JWKS');
    throw error;
  }
}

/**
 * Carregar chaves ativas do PostgreSQL
 */
async function loadJWKsFromDatabase(): Promise<JWK[]> {
  const db = getDatabase();

  try {
    const keys = await db.select()
      .from(oidcJwks)
      .where(eq(oidcJwks.ativo, true))
      .orderBy(desc(oidcJwks.criadoEm))
      .limit(3); // Máximo 3 chaves ativas (rotação)

    if (keys.length === 0) {
      return [];
    }

    logger.debug({ count: keys.length }, 'Chaves JWKS carregadas do PostgreSQL');

    return keys.map((k) => {
      const privateKeyData = k.privateKey as Record<string, unknown> || {};
      return {
        ...privateKeyData,
        kid: k.kid,
        alg: k.alg,
        use: k.use,
      } as JWK;
    });
  } catch (error) {
    logger.error({ error }, 'Erro ao carregar chaves JWKS do PostgreSQL');
    return [];
  }
}

/**
 * Obter JWKs para o OIDC Provider
 * Prioridade: PostgreSQL → Variável de ambiente → Gerar nova
 * Seguindo Regra 6: persistência obrigatória
 */
export async function getJWKS(): Promise<{ keys: JWK[] }> {
  // 1. Tentar carregar do PostgreSQL (fonte de verdade)
  const dbKeys = await loadJWKsFromDatabase();
  if (dbKeys.length > 0) {
    logger.debug('JWKS carregado do PostgreSQL');
    return { keys: dbKeys };
  }

  // 2. Verificar variável de ambiente (fallback para produção inicial)
  const envJwks = process.env.OIDC_JWKS;
  if (envJwks) {
    try {
      const parsed = JSON.parse(envJwks) as { keys: JWK[] };
      
      // Persistir no banco para próximas reinicializações
      for (const key of parsed.keys) {
        if (key.kid) {
          const publicKey = { ...key };
          // Remover propriedades privadas para chave pública
          delete (publicKey as Record<string, unknown>).d;
          delete (publicKey as Record<string, unknown>).p;
          delete (publicKey as Record<string, unknown>).q;
          delete (publicKey as Record<string, unknown>).dp;
          delete (publicKey as Record<string, unknown>).dq;
          delete (publicKey as Record<string, unknown>).qi;
          
          await persistJWK(key.kid, key, publicKey).catch(() => {
            // Ignorar erro se chave já existe
          });
        }
      }

      logger.info('JWKS carregado de variável de ambiente e persistido');
      return parsed;
    } catch (error) {
      logger.error({ error }, 'Erro ao parsear OIDC_JWKS');
    }
  }

  // 3. Gerar nova chave e persistir (primeira execução)
  logger.info('Gerando nova chave JWKS (primeira execução)');
  const { privateKey, publicKey, kid } = await generateRSAKeyPair();
  
  // Persistir no PostgreSQL
  await persistJWK(kid, privateKey, publicKey);
  
  const jwks = {
    keys: [privateKey],
  };

  logger.info({ kid }, 'Nova chave JWKS gerada e persistida no PostgreSQL');

  return jwks;
}

/**
 * Obter apenas chaves públicas (para endpoint /.well-known/jwks.json)
 */
export async function getPublicJWKS(): Promise<{ keys: JWK[] }> {
  const jwks = await getJWKS();
  
  // Filtrar apenas propriedades públicas (remover propriedades privadas RSA)
  // Prefixo _ indica variáveis intencionalmente não usadas (destructuring para omissão)
  const publicKeys = jwks.keys.map((key) => {
    const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicKey } = key as JWK & {
      d?: string;
      p?: string;
      q?: string;
      dp?: string;
      dq?: string;
      qi?: string;
    };
    return publicKey;
  });

  return { keys: publicKeys };
}

/**
 * Rotacionar chaves (para segurança em produção)
 * Adiciona nova chave e marca antigas como inativas após período
 */
export async function rotateKeys(): Promise<string> {
  const db = getDatabase();
  
  // Gerar nova chave
  const { privateKey, publicKey, kid } = await generateRSAKeyPair();
  
  // Persistir nova chave
  await persistJWK(kid, privateKey, publicKey);
  
  // Marcar chaves antigas para rotação (manter ativas por período de transição)
  const oldKeys = await db.select()
    .from(oidcJwks)
    .where(eq(oidcJwks.ativo, true))
    .orderBy(desc(oidcJwks.criadoEm));
  
  // Manter apenas 3 chaves ativas (nova + 2 anteriores)
  if (oldKeys.length > 3) {
    for (let i = 3; i < oldKeys.length; i++) {
      await db.update(oidcJwks)
        .set({ 
          ativo: false,
          rotacionadoEm: new Date(),
        })
        .where(eq(oidcJwks.id, oldKeys[i].id));
    }
  }

  logger.info({ newKid: kid, totalActive: Math.min(oldKeys.length + 1, 3) }, 'Chaves OIDC rotacionadas');
  
  return kid;
}

/**
 * Gerar script de JWKS para produção
 * Útil para criar variável de ambiente OIDC_JWKS inicial
 */
export async function generateProductionJWKS(): Promise<string> {
  const { privateKey } = await generateRSAKeyPair();
  
  const jwks = {
    keys: [privateKey],
  };

  return JSON.stringify(jwks);
}

/**
 * Validar formato de JWKS
 */
export function validateJWKS(jwksString: string): boolean {
  try {
    const parsed = JSON.parse(jwksString);
    
    if (!parsed.keys || !Array.isArray(parsed.keys)) {
      return false;
    }

    for (const key of parsed.keys) {
      if (!key.kty || !key.kid || !key.alg) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
