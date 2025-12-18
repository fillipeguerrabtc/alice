/**
 * Grafana Admin API Client - Identity Provisioning
 * 
 * Cliente para sincronização de usuários Alice → Grafana
 * via Grafana Admin API (HTTP Basic Auth)
 * 
 * Documentação: https://grafana.com/docs/grafana/latest/developers/http_api/admin/
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import { createLogger } from '@alice/logger';
import crypto from 'crypto';

const logger = createLogger('grafana-client');

// CORREÇÃO AUDITORIA 17/12/2025: Timeout para chamadas à API externa
// Bug: fetch() sem timeout pode travar o serviço indefinidamente
const GRAFANA_API_TIMEOUT_MS = 30000; // 30 segundos

// Role mapping Alice → Grafana (Tarefa 9)
const ROLE_MAPPING: Record<string, string> = {
  super_admin: 'Admin',
  admin: 'Admin',
  manager: 'Editor',
  operator: 'Editor',
  viewer: 'Viewer',
  guest: 'Viewer',
};

export interface GrafanaUser {
  id: number;
  login: string;
  email: string;
  name: string;
  isAdmin: boolean;
  isDisabled: boolean;
  orgId: number;
}

export interface GrafanaCreateUserRequest {
  login: string;
  email: string;
  name: string;
  password?: string;
}

export interface GrafanaUpdateUserRequest {
  login?: string;
  email?: string;
  name?: string;
  [key: string]: string | undefined;
}

export interface GrafanaClientConfig {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
}

/**
 * Cliente Grafana Admin API
 */
export class GrafanaClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: GrafanaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + Buffer.from(`${config.adminUser}:${config.adminPassword}`).toString('base64');
  }

  /**
   * Fazer requisição à API do Grafana
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    // CORREÇÃO AUDITORIA 17/12/2025: Adicionado timeout via AbortSignal
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(GRAFANA_API_TIMEOUT_MS),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    logger.debug({ method, path }, 'Requisição Grafana API');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ 
        status: response.status, 
        statusText: response.statusText,
        error: errorText,
        path,
      }, 'Erro na API Grafana');
      throw new Error(`Grafana API error: ${response.status} - ${errorText}`);
    }

    // Algumas respostas Grafana são vazias (204 No Content)
    if (response.status === 204) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  /**
   * Buscar usuário por login (email)
   */
  async getUserByLogin(login: string): Promise<GrafanaUser | null> {
    try {
      const users = await this.request<GrafanaUser[]>(
        'GET',
        `/api/users/lookup?loginOrEmail=${encodeURIComponent(login)}`,
      );
      
      // A API retorna um único usuário ou erro 404
      // Tratamos o caso de array vazio
      if (Array.isArray(users) && users.length > 0) {
        return users[0];
      }
      
      return users as unknown as GrafanaUser;
    } catch (error) {
      // 404 significa usuário não encontrado
      if (String(error).includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Criar novo usuário
   */
  async createUser(user: GrafanaCreateUserRequest): Promise<{ id: number }> {
    logger.info({ email: user.email }, 'Criando usuário no Grafana');
    
    return this.request<{ id: number }>('POST', '/api/admin/users', {
      login: user.login,
      email: user.email,
      name: user.name,
      password: user.password || this.generateRandomPassword(),
    });
  }

  /**
   * Atualizar usuário existente
   */
  async updateUser(userId: number, updates: GrafanaUpdateUserRequest): Promise<void> {
    logger.info({ userId, updates }, 'Atualizando usuário no Grafana');
    
    await this.request<{ message: string }>('PUT', `/api/users/${userId}`, updates);
  }

  /**
   * Deletar usuário
   */
  async deleteUser(userId: number): Promise<void> {
    logger.info({ userId }, 'Removendo usuário do Grafana');
    
    await this.request<{ message: string }>('DELETE', `/api/admin/users/${userId}`);
  }

  /**
   * Desativar usuário (sem deletar)
   */
  async disableUser(userId: number): Promise<void> {
    logger.info({ userId }, 'Desativando usuário no Grafana');
    
    await this.request<{ message: string }>(
      'PUT',
      `/api/admin/users/${userId}/disable`,
    );
  }

  /**
   * Ativar usuário
   */
  async enableUser(userId: number): Promise<void> {
    logger.info({ userId }, 'Ativando usuário no Grafana');
    
    await this.request<{ message: string }>(
      'PUT',
      `/api/admin/users/${userId}/enable`,
    );
  }

  /**
   * Atualizar role do usuário na organização
   */
  async updateUserOrgRole(userId: number, orgId: number, aliceRole: string): Promise<void> {
    const grafanaRole = ROLE_MAPPING[aliceRole] || 'Viewer';
    
    logger.info({ userId, orgId, aliceRole, grafanaRole }, 'Atualizando role no Grafana');
    
    await this.request<{ message: string }>(
      'PATCH',
      `/api/orgs/${orgId}/users/${userId}`,
      { role: grafanaRole },
    );
  }

  /**
   * Adicionar usuário à organização
   */
  async addUserToOrg(userId: number, orgId: number, aliceRole: string): Promise<void> {
    const grafanaRole = ROLE_MAPPING[aliceRole] || 'Viewer';
    
    logger.info({ userId, orgId, grafanaRole }, 'Adicionando usuário à organização Grafana');
    
    await this.request<{ message: string }>(
      'POST',
      `/api/orgs/${orgId}/users`,
      { loginOrEmail: String(userId), role: grafanaRole },
    );
  }

  /**
   * Verificar se Grafana está acessível
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ database: string }>('GET', '/api/health');
      return true;
    } catch (error) {
      logger.error({ error }, 'Grafana health check falhou');
      return false;
    }
  }

  /**
   * Gerar senha aleatória para novos usuários
   * Usuários SSO não precisam de senha, mas Grafana requer
   * 
   * CORREÇÃO AUDITORIA 17/12/2025: Math.random() não é criptograficamente seguro
   * Usando crypto.randomBytes() para geração segura de senhas
   */
  private generateRandomPassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const randomBytes = crypto.randomBytes(32);
    let password = '';
    for (let i = 0; i < 32; i++) {
      password += chars.charAt(randomBytes[i] % chars.length);
    }
    return password;
  }

  /**
   * Mapear role Alice para Grafana
   */
  static mapRole(aliceRole: string): string {
    return ROLE_MAPPING[aliceRole] || 'Viewer';
  }
}

/**
 * Criar cliente Grafana a partir de variáveis de ambiente
 */
export function createGrafanaClient(): GrafanaClient | null {
  const baseUrl = process.env.GRAFANA_URL;
  const adminUser = process.env.GRAFANA_ADMIN_USER;
  const adminPassword = process.env.GRAFANA_ADMIN_PASSWORD;

  if (!baseUrl || !adminUser || !adminPassword) {
    logger.warn('Grafana client não configurado - variáveis de ambiente ausentes');
    return null;
  }

  return new GrafanaClient({
    baseUrl,
    adminUser,
    adminPassword,
  });
}
