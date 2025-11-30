/**
 * OIDC Adapter PostgreSQL - Alice Enterprise Platform
 * Persistência de tokens, codes e grants no PostgreSQL
 * 
 * Seguindo Regra 6 replit.md: PROIBIDO in-memory storage
 * Best Practices 2025: node-oidc-provider v9.5.2
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import type { Adapter, AdapterPayload } from 'oidc-provider';
import { getDatabase } from '@alice/database';
import { oidcPayloads } from '@alice/shared/schema';
import { eq, and, lt } from '@alice/database';
import { createLogger } from '@alice/logger';

const logger = createLogger('oidc-adapter');

// Tipos de modelo suportados pelo oidc-provider
type ModelName = 
  | 'AccessToken'
  | 'AuthorizationCode'
  | 'RefreshToken'
  | 'DeviceCode'
  | 'ClientCredentials'
  | 'Client'
  | 'InitialAccessToken'
  | 'RegistrationAccessToken'
  | 'Interaction'
  | 'ReplayDetection'
  | 'PushedAuthorizationRequest'
  | 'Grant'
  | 'Session';

/**
 * Adapter PostgreSQL para oidc-provider
 * Implementa interface padrão do oidc-provider para persistência
 */
export class PostgresAdapter implements Adapter {
  private name: ModelName;

  constructor(name: string) {
    this.name = name as ModelName;
  }

  /**
   * Gera chave única para o payload
   */
  private key(id: string): string {
    return `${this.name}:${id}`;
  }

  /**
   * Salvar ou atualizar payload (upsert)
   */
  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number
  ): Promise<void> {
    const db = getDatabase();
    const key = this.key(id);
    
    const expiresAt = expiresIn 
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

    const data = {
      id: key,
      type: this.name,
      payload: payload as unknown as Record<string, unknown>,
      grantId: payload.grantId || null,
      userCode: payload.userCode || null,
      uid: payload.uid || null,
      expiresAt,
    };

    try {
      // Tentar inserir, se falhar atualizar
      await db.insert(oidcPayloads)
        .values(data)
        .onConflictDoUpdate({
          target: oidcPayloads.id,
          set: {
            payload: data.payload,
            grantId: data.grantId,
            userCode: data.userCode,
            uid: data.uid,
            expiresAt: data.expiresAt,
          },
        });
      
      logger.debug({ key, type: this.name }, 'OIDC payload salvo');
    } catch (error) {
      logger.error({ error, key, type: this.name }, 'Erro ao salvar OIDC payload');
      throw error;
    }
  }

  /**
   * Buscar payload por ID
   */
  async find(id: string): Promise<AdapterPayload | undefined> {
    const db = getDatabase();
    const key = this.key(id);

    try {
      const rows = await db.select()
        .from(oidcPayloads)
        .where(eq(oidcPayloads.id, key))
        .limit(1);
      
      if (!rows.length) return undefined;
      
      const row = rows[0];
      
      // Verificar expiração
      if (row.expiresAt && row.expiresAt < new Date()) {
        logger.debug({ key }, 'OIDC payload expirado');
        return undefined;
      }

      const payload = row.payload as AdapterPayload;
      
      // Adicionar consumedAt se existir
      if (row.consumedAt) {
        return { ...payload, consumed: true };
      }

      return payload;
    } catch (error) {
      logger.error({ error, key }, 'Erro ao buscar OIDC payload');
      return undefined;
    }
  }

  /**
   * Buscar por userCode (usado em Device Flow)
   */
  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const db = getDatabase();

    try {
      const rows = await db.select()
        .from(oidcPayloads)
        .where(and(
          eq(oidcPayloads.type, this.name),
          eq(oidcPayloads.userCode, userCode)
        ))
        .limit(1);
      
      if (!rows.length) return undefined;
      
      const row = rows[0];
      
      // Verificar expiração
      if (row.expiresAt && row.expiresAt < new Date()) {
        return undefined;
      }

      const payload = row.payload as AdapterPayload;
      
      if (row.consumedAt) {
        return { ...payload, consumed: true };
      }

      return payload;
    } catch (error) {
      logger.error({ error, userCode }, 'Erro ao buscar por userCode');
      return undefined;
    }
  }

  /**
   * Buscar por UID (usado em interações)
   */
  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const db = getDatabase();

    try {
      const rows = await db.select()
        .from(oidcPayloads)
        .where(and(
          eq(oidcPayloads.type, this.name),
          eq(oidcPayloads.uid, uid)
        ))
        .limit(1);
      
      if (!rows.length) return undefined;
      
      const row = rows[0];
      
      // Verificar expiração
      if (row.expiresAt && row.expiresAt < new Date()) {
        return undefined;
      }

      const payload = row.payload as AdapterPayload;
      
      if (row.consumedAt) {
        return { ...payload, consumed: true };
      }

      return payload;
    } catch (error) {
      logger.error({ error, uid }, 'Erro ao buscar por uid');
      return undefined;
    }
  }

  /**
   * Marcar token como consumido (usado em authorization codes)
   */
  async consume(id: string): Promise<void> {
    const db = getDatabase();
    const key = this.key(id);

    try {
      await db.update(oidcPayloads)
        .set({ consumedAt: new Date() })
        .where(eq(oidcPayloads.id, key));
      
      logger.debug({ key }, 'OIDC payload consumido');
    } catch (error) {
      logger.error({ error, key }, 'Erro ao consumir OIDC payload');
      throw error;
    }
  }

  /**
   * Destruir/remover payload
   */
  async destroy(id: string): Promise<void> {
    const db = getDatabase();
    const key = this.key(id);

    try {
      await db.delete(oidcPayloads)
        .where(eq(oidcPayloads.id, key));
      
      logger.debug({ key }, 'OIDC payload destruído');
    } catch (error) {
      logger.error({ error, key }, 'Erro ao destruir OIDC payload');
      throw error;
    }
  }

  /**
   * Revogar todos os tokens de um grant
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    const db = getDatabase();

    try {
      await db.delete(oidcPayloads)
        .where(eq(oidcPayloads.grantId, grantId));
      
      logger.info({ grantId }, 'Todos os tokens do grant revogados');
    } catch (error) {
      logger.error({ error, grantId }, 'Erro ao revogar tokens do grant');
      throw error;
    }
  }
}

/**
 * Factory function para criar adapter
 * Usada pelo oidc-provider
 */
export function createAdapter(name: string): Adapter {
  return new PostgresAdapter(name);
}

/**
 * Limpar payloads expirados (job de manutenção)
 * Deve ser executado periodicamente via cron
 */
export async function cleanupExpiredPayloads(): Promise<number> {
  const db = getDatabase();
  
  try {
    const result = await db.delete(oidcPayloads)
      .where(lt(oidcPayloads.expiresAt, new Date()));
    
    const count = result.rowCount || 0;
    
    if (count > 0) {
      logger.info({ count }, 'Payloads OIDC expirados removidos');
    }
    
    return count;
  } catch (error) {
    logger.error({ error }, 'Erro ao limpar payloads expirados');
    throw error;
  }
}

export type { Adapter, AdapterPayload };
