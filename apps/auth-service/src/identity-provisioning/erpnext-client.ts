/**
 * ERPNext API Client - Identity Provisioning
 * 
 * Cliente para sincronização de usuários Alice → ERPNext
 * via Frappe REST API
 * 
 * Documentação: https://frappeframework.com/docs/v14/user/en/api
 * 
 * @author Alice Team
 * @version 1.0.0
 */

import { createLogger } from '@alice/logger';
import crypto from 'crypto';

const logger = createLogger('erpnext-client');

// Role mapping Alice → ERPNext (Tarefa 9)
const ROLE_MAPPING: Record<string, string[]> = {
  super_admin: ['System Manager', 'Administrator'],
  admin: ['System Manager'],
  manager: ['Sales Manager', 'Purchase Manager'],
  operator: ['Sales User', 'Purchase User'],
  viewer: ['Guest'],
  guest: ['Guest'],
};

export interface ERPNextUser {
  name: string;
  email: string;
  full_name: string;
  first_name: string;
  last_name: string;
  enabled: boolean;
  user_type: string;
  roles: { role: string }[];
}

export interface ERPNextCreateUserRequest {
  email: string;
  first_name: string;
  last_name?: string;
  full_name?: string;
  send_welcome_email?: boolean;
  new_password?: string;
}

export interface ERPNextUpdateUserRequest {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  enabled?: boolean;
  [key: string]: string | boolean | undefined;
}

export interface ERPNextClientConfig {
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Cliente ERPNext Frappe API
 */
export class ERPNextClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ERPNextClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authHeader = `token ${config.apiKey}:${config.apiSecret}`;
  }

  /**
   * Fazer requisição à API do ERPNext
   */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': this.authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    logger.debug({ method, path }, 'Requisição ERPNext API');

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ 
        status: response.status, 
        statusText: response.statusText,
        error: errorText,
        path,
      }, 'Erro na API ERPNext');
      throw new Error(`ERPNext API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as Record<string, unknown>;
    
    // ERPNext wraps responses in { data: ... } or { message: ... }
    if ('data' in data) {
      return data.data as T;
    }
    if ('message' in data) {
      return data.message as T;
    }
    
    return data as T;
  }

  /**
   * Buscar usuário por email
   */
  async getUserByEmail(email: string): Promise<ERPNextUser | null> {
    try {
      const user = await this.request<ERPNextUser>(
        'GET',
        `/api/resource/User/${encodeURIComponent(email)}`,
      );
      return user;
    } catch (error) {
      // 404 significa usuário não encontrado
      if (String(error).includes('404') || String(error).includes('DoesNotExistError')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Criar novo usuário
   */
  async createUser(user: ERPNextCreateUserRequest): Promise<ERPNextUser> {
    logger.info({ email: user.email }, 'Criando usuário no ERPNext');
    
    return this.request<ERPNextUser>('POST', '/api/resource/User', {
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name || '',
      full_name: user.full_name || `${user.first_name} ${user.last_name || ''}`.trim(),
      send_welcome_email: user.send_welcome_email ?? false,
      new_password: user.new_password || this.generateRandomPassword(),
      user_type: 'System User',
      enabled: 1,
    });
  }

  /**
   * Atualizar usuário existente
   */
  async updateUser(email: string, updates: ERPNextUpdateUserRequest): Promise<ERPNextUser> {
    logger.info({ email, updates }, 'Atualizando usuário no ERPNext');
    
    return this.request<ERPNextUser>(
      'PUT',
      `/api/resource/User/${encodeURIComponent(email)}`,
      updates,
    );
  }

  /**
   * Deletar usuário
   */
  async deleteUser(email: string): Promise<void> {
    logger.info({ email }, 'Removendo usuário do ERPNext');
    
    await this.request<{ message: string }>(
      'DELETE',
      `/api/resource/User/${encodeURIComponent(email)}`,
    );
  }

  /**
   * Desativar usuário (sem deletar)
   */
  async disableUser(email: string): Promise<void> {
    logger.info({ email }, 'Desativando usuário no ERPNext');
    
    await this.updateUser(email, { enabled: false });
  }

  /**
   * Ativar usuário
   */
  async enableUser(email: string): Promise<void> {
    logger.info({ email }, 'Ativando usuário no ERPNext');
    
    await this.updateUser(email, { enabled: true });
  }

  /**
   * Atualizar roles do usuário
   */
  async updateUserRoles(email: string, aliceRole: string): Promise<void> {
    const erpnextRoles = ROLE_MAPPING[aliceRole] || ['Guest'];
    
    logger.info({ email, aliceRole, erpnextRoles }, 'Atualizando roles no ERPNext');
    
    // ERPNext requer format especial para roles
    const rolesPayload = erpnextRoles.map(role => ({ role }));
    
    await this.request<ERPNextUser>(
      'PUT',
      `/api/resource/User/${encodeURIComponent(email)}`,
      { roles: rolesPayload },
    );
  }

  /**
   * Adicionar role ao usuário
   */
  async addRoleToUser(email: string, role: string): Promise<void> {
    logger.info({ email, role }, 'Adicionando role ao usuário ERPNext');
    
    await this.request<{ message: string }>(
      'POST',
      '/api/method/frappe.client.insert',
      {
        doc: {
          doctype: 'Has Role',
          parent: email,
          parenttype: 'User',
          parentfield: 'roles',
          role,
        },
      },
    );
  }

  /**
   * Verificar se ERPNext está acessível
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ message: string }>('GET', '/api/method/ping');
      return true;
    } catch (error) {
      logger.error({ error }, 'ERPNext health check falhou');
      return false;
    }
  }

  /**
   * Gerar senha aleatória para novos usuários
   * Usuários SSO não precisam de senha, mas ERPNext requer
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
   * Mapear role Alice para ERPNext
   */
  static mapRoles(aliceRole: string): string[] {
    return ROLE_MAPPING[aliceRole] || ['Guest'];
  }
}

/**
 * Criar cliente ERPNext a partir de variáveis de ambiente
 */
export function createERPNextClient(): ERPNextClient | null {
  const baseUrl = process.env.ERPNEXT_URL;
  const apiKey = process.env.ERPNEXT_API_KEY;
  const apiSecret = process.env.ERPNEXT_API_SECRET;

  if (!baseUrl || !apiKey || !apiSecret) {
    logger.warn('ERPNext client não configurado - variáveis de ambiente ausentes');
    return null;
  }

  return new ERPNextClient({
    baseUrl,
    apiKey,
    apiSecret,
  });
}
