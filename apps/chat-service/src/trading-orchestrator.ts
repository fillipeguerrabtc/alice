/**
 * Trading Orchestrator - Alice Enterprise Platform
 * 
 * Gerencia handover/takeover de operações de trading entre Alice (IA) e operador humano.
 * Baseado no padrão de conversation-orchestrator.ts, adaptado para trading.
 * 
 * Funcionalidades:
 * - Takeover: Operador assume controle manual do trading
 * - Handback: Devolve controle para Alice operar autonomamente
 * - Auditoria: Registra todas as mudanças de controle em DB
 * - Validações: Verifica permissões e estado atual antes de mudanças
 * 
 * Regra 6 - SEM MOCKS: Persistência real em PostgreSQL
 * Regra 8 - TypeScript strict, zero any
 * 
 * Autor: Fillipe Guerra
 * Data: 17 de Dezembro de 2025
 */

import { eq, and, desc } from '@alice/database';
import { createLogger } from '@alice/logger';
import * as schema from '@alice/shared/schema';
import type { Database } from '@alice/database';

const logger = createLogger('trading-orchestrator');

let db: Database;

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================

/**
 * Inicializa o orchestrator com conexão ao banco
 */
export function initTradingOrchestrator(dbClient: Database): void {
  db = dbClient;
  logger.info('Trading orchestrator inicializado');
}

// ============================================================================
// TIPOS
// ============================================================================

/** Modo de controle de trading */
export type TradingControlMode = 'alice' | 'manual';

/** Resultado de operação de handover/takeover */
export interface TradingControlResult {
  success: boolean;
  previousMode: TradingControlMode;
  newMode: TradingControlMode;
  message: string;
  error?: string;
  historyId?: string;
}

/** Estado atual do controle de trading */
export interface TradingControlState {
  tenantId: string;
  mode: TradingControlMode;
  lastChangedAt: Date | null;
  lastChangedBy: string | null;
  tradingEnabled: boolean;
  autoExecuteSignals: boolean;
}

/** Registro de histórico de controle */
export interface TradingControlHistoryEntry {
  id: string;
  tenantId: string;
  previousMode: TradingControlMode;
  newMode: TradingControlMode;
  changedBy: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  criadoEm: Date;
}

// ============================================================================
// QUERIES DE ESTADO
// ============================================================================

/**
 * Obtém o estado atual de controle de trading para um tenant
 */
export async function getTradingControlState(tenantId: string): Promise<TradingControlState> {
  // Buscar configuração de risco que contém tradingEnabled e autoExecuteSignals
  const [config] = await db
    .select()
    .from(schema.tradingRiskConfig)
    .where(eq(schema.tradingRiskConfig.tenantId, tenantId))
    .limit(1);

  // Buscar último histórico de controle
  const [lastHistory] = await db
    .select()
    .from(schema.tradingControlHistory)
    .where(eq(schema.tradingControlHistory.tenantId, tenantId))
    .orderBy(desc(schema.tradingControlHistory.criadoEm))
    .limit(1);

  // Determinar modo atual
  // Se autoExecuteSignals = true → Alice no controle
  // Se autoExecuteSignals = false → Manual
  const currentMode: TradingControlMode = config?.autoExecuteSignals ? 'alice' : 'manual';

  return {
    tenantId,
    mode: currentMode,
    lastChangedAt: lastHistory?.criadoEm || null,
    lastChangedBy: lastHistory?.changedBy || null,
    tradingEnabled: config?.tradingEnabled || false,
    autoExecuteSignals: config?.autoExecuteSignals || false,
  };
}

/**
 * Obtém modo de controle atual (simplificado)
 */
export async function getTradingControlMode(tenantId: string): Promise<TradingControlMode> {
  const state = await getTradingControlState(tenantId);
  return state.mode;
}

/**
 * Verifica se Alice está no controle
 */
export async function isAliceInControl(tenantId: string): Promise<boolean> {
  const mode = await getTradingControlMode(tenantId);
  return mode === 'alice';
}

/**
 * Verifica se trading está habilitado
 */
export async function isTradingEnabled(tenantId: string): Promise<boolean> {
  const state = await getTradingControlState(tenantId);
  return state.tradingEnabled;
}

// ============================================================================
// TAKEOVER / HANDBACK
// ============================================================================

/**
 * Operador assume controle manual do trading (takeover)
 * 
 * CORREÇÃO 17/12/2025: Operações de update config e insert history agora são atômicas
 * usando transação. Se qualquer operação falhar, toda a transação é revertida (rollback).
 * Isso evita inconsistência onde o banco está em modo 'manual' mas o erro retorna 'alice'.
 */
export async function initiateTradingTakeover(
  tenantId: string,
  userId: string,
  reason?: string
): Promise<TradingControlResult> {
  try {
    const currentState = await getTradingControlState(tenantId);

    // Verificar se já está em modo manual
    if (currentState.mode === 'manual') {
      return {
        success: false,
        previousMode: 'manual',
        newMode: 'manual',
        message: 'Trading já está em modo manual',
        error: 'already_manual',
      };
    }

    // Verificar se trading está habilitado
    if (!currentState.tradingEnabled) {
      return {
        success: false,
        previousMode: currentState.mode,
        newMode: currentState.mode,
        message: 'Trading não está habilitado para este tenant',
        error: 'trading_disabled',
      };
    }

    // CORREÇÃO: Usar transação para garantir atomicidade
    // Se qualquer operação falhar, toda a transação é revertida
    const result = await db.transaction(async (tx) => {
      // Atualizar configuração para desabilitar auto-execute
      await tx
        .update(schema.tradingRiskConfig)
        .set({
          autoExecuteSignals: false,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingRiskConfig.tenantId, tenantId));

      // Registrar no histórico
      const [historyEntry] = await tx
        .insert(schema.tradingControlHistory)
        .values({
          tenantId,
          previousMode: 'alice',
          newMode: 'manual',
          changedBy: userId,
          reason: reason || 'Takeover manual solicitado pelo operador',
          metadata: {
            source: 'trading-orchestrator',
            timestamp: new Date().toISOString(),
          },
        })
        .returning();

      return historyEntry;
    });

    logger.info({ tenantId, userId, reason }, 'Takeover de trading realizado');

    return {
      success: true,
      previousMode: 'alice',
      newMode: 'manual',
      message: 'Controle de trading assumido com sucesso',
      historyId: result?.id,
    };
  } catch (error) {
    // CORREÇÃO: Em caso de erro, consultar estado real do banco para retornar modo correto
    // Isso garante que o resultado reflita o estado atual, não um valor hardcoded
    logger.error({ tenantId, userId, error: (error as Error).message }, 'Erro no takeover de trading');
    
    let actualMode: TradingControlMode = 'alice';
    try {
      const state = await getTradingControlState(tenantId);
      actualMode = state.mode;
    } catch {
      // Se não conseguir ler estado, manter 'alice' como fallback seguro
    }
    
    return {
      success: false,
      previousMode: actualMode,
      newMode: actualMode,
      message: 'Erro ao assumir controle de trading',
      error: (error as Error).message,
    };
  }
}

/**
 * Operador devolve controle para Alice (handback)
 * 
 * CORREÇÃO 17/12/2025: Operações de update config e insert history agora são atômicas
 * usando transação. Se qualquer operação falhar, toda a transação é revertida (rollback).
 * Isso evita inconsistência onde o banco está em modo 'alice' mas o erro retorna 'manual'.
 */
export async function handbackTradingToAlice(
  tenantId: string,
  userId: string,
  reason?: string
): Promise<TradingControlResult> {
  try {
    const currentState = await getTradingControlState(tenantId);

    // Verificar se já está em modo alice
    if (currentState.mode === 'alice') {
      return {
        success: false,
        previousMode: 'alice',
        newMode: 'alice',
        message: 'Alice já está no controle do trading',
        error: 'already_alice',
      };
    }

    // Verificar se trading está habilitado
    if (!currentState.tradingEnabled) {
      return {
        success: false,
        previousMode: currentState.mode,
        newMode: currentState.mode,
        message: 'Trading não está habilitado para este tenant',
        error: 'trading_disabled',
      };
    }

    // CORREÇÃO: Usar transação para garantir atomicidade
    // Se qualquer operação falhar, toda a transação é revertida
    const result = await db.transaction(async (tx) => {
      // Atualizar configuração para habilitar auto-execute
      await tx
        .update(schema.tradingRiskConfig)
        .set({
          autoExecuteSignals: true,
          atualizadoEm: new Date(),
        })
        .where(eq(schema.tradingRiskConfig.tenantId, tenantId));

      // Registrar no histórico
      const [historyEntry] = await tx
        .insert(schema.tradingControlHistory)
        .values({
          tenantId,
          previousMode: 'manual',
          newMode: 'alice',
          changedBy: userId,
          reason: reason || 'Controle devolvido para Alice',
          metadata: {
            source: 'trading-orchestrator',
            timestamp: new Date().toISOString(),
          },
        })
        .returning();

      return historyEntry;
    });

    logger.info({ tenantId, userId, reason }, 'Handback de trading para Alice realizado');

    return {
      success: true,
      previousMode: 'manual',
      newMode: 'alice',
      message: 'Controle devolvido para Alice com sucesso',
      historyId: result?.id,
    };
  } catch (error) {
    // CORREÇÃO: Em caso de erro, consultar estado real do banco para retornar modo correto
    // Isso garante que o resultado reflita o estado atual, não um valor hardcoded
    logger.error({ tenantId, userId, error: (error as Error).message }, 'Erro no handback de trading');
    
    let actualMode: TradingControlMode = 'manual';
    try {
      const state = await getTradingControlState(tenantId);
      actualMode = state.mode;
    } catch {
      // Se não conseguir ler estado, manter 'manual' como fallback seguro
    }
    
    return {
      success: false,
      previousMode: actualMode,
      newMode: actualMode,
      message: 'Erro ao devolver controle para Alice',
      error: (error as Error).message,
    };
  }
}

/**
 * Alterna modo de controle (toggle)
 */
export async function toggleTradingControl(
  tenantId: string,
  userId: string,
  reason?: string
): Promise<TradingControlResult> {
  const currentMode = await getTradingControlMode(tenantId);
  
  if (currentMode === 'alice') {
    return initiateTradingTakeover(tenantId, userId, reason);
  } else {
    return handbackTradingToAlice(tenantId, userId, reason);
  }
}

// ============================================================================
// HISTÓRICO
// ============================================================================

/**
 * Obtém histórico de mudanças de controle
 */
export async function getTradingControlHistory(
  tenantId: string,
  limit: number = 50
): Promise<TradingControlHistoryEntry[]> {
  const entries = await db
    .select()
    .from(schema.tradingControlHistory)
    .where(eq(schema.tradingControlHistory.tenantId, tenantId))
    .orderBy(desc(schema.tradingControlHistory.criadoEm))
    .limit(limit);

  return entries.map(entry => ({
    id: entry.id,
    tenantId: entry.tenantId,
    previousMode: entry.previousMode as TradingControlMode,
    newMode: entry.newMode as TradingControlMode,
    changedBy: entry.changedBy || '',
    reason: entry.reason,
    metadata: entry.metadata as Record<string, unknown> | null,
    criadoEm: entry.criadoEm || new Date(),
  }));
}

/**
 * Obtém última mudança de controle
 */
export async function getLastControlChange(tenantId: string): Promise<TradingControlHistoryEntry | null> {
  const [entry] = await getTradingControlHistory(tenantId, 1);
  return entry || null;
}

// ============================================================================
// VALIDAÇÕES PARA COMANDOS
// ============================================================================

/**
 * Valida se um comando de trading pode ser executado
 */
export async function canExecuteTradingCommand(
  tenantId: string,
  commandSource: 'alice' | 'user'
): Promise<{
  canExecute: boolean;
  reason?: string;
}> {
  const state = await getTradingControlState(tenantId);

  // Trading precisa estar habilitado
  if (!state.tradingEnabled) {
    return {
      canExecute: false,
      reason: 'Trading não está habilitado',
    };
  }

  // Se comando vem de Alice, precisa estar em modo Alice
  if (commandSource === 'alice' && state.mode !== 'alice') {
    return {
      canExecute: false,
      reason: 'Trading está em modo manual - Alice não pode executar ordens',
    };
  }

  // Se comando vem de usuário, pode executar em ambos os modos
  // (mas em modo Alice, o usuário pode estar apenas solicitando via chat)
  return {
    canExecute: true,
  };
}

/**
 * Obtém mensagem de status para o usuário
 */
export async function getTradingStatusMessage(tenantId: string, language: 'pt' | 'en' = 'pt'): Promise<string> {
  const state = await getTradingControlState(tenantId);

  const messages = {
    pt: {
      disabled: 'Trading não está habilitado para sua conta.',
      alice: 'Alice está operando autonomamente. Posso pausar ou você pode assumir o controle manual.',
      manual: 'Trading está em modo manual. Você está no controle. Posso retomar quando desejar.',
    },
    en: {
      disabled: 'Trading is not enabled for your account.',
      alice: 'Alice is trading autonomously. I can pause or you can take manual control.',
      manual: 'Trading is in manual mode. You are in control. I can resume when you want.',
    },
  };

  if (!state.tradingEnabled) {
    return messages[language].disabled;
  }

  return state.mode === 'alice' ? messages[language].alice : messages[language].manual;
}

export default {
  initTradingOrchestrator,
  getTradingControlState,
  getTradingControlMode,
  isAliceInControl,
  isTradingEnabled,
  initiateTradingTakeover,
  handbackTradingToAlice,
  toggleTradingControl,
  getTradingControlHistory,
  getLastControlChange,
  canExecuteTradingCommand,
  getTradingStatusMessage,
};
