/**
 * Alice Enterprise Platform - Auth Service OpenAPI Specs
 * 
 * Documentação OpenAPI 3.0 para o serviço de autenticação.
 * Specs definidas como objeto para compatibilidade com esbuild.
 * 
 * Author: Fillipe Guerra
 * Data: 23/01/2026
 * 
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

// Paths OpenAPI para auth-service (38 endpoints)
export const authServicePaths = {
  '/health': {
    get: {
      summary: 'Health check básico',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Serviço saudável',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'ok' },
                  service: { type: 'string', example: 'auth-service' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/ready': {
    get: {
      summary: 'Readiness check com dependências',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Serviço pronto',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/HealthCheck' },
            },
          },
        },
        503: { description: 'Serviço não pronto' },
      },
    },
  },
  '/api/auth/csrf-token': {
    get: {
      summary: 'Obtém token CSRF',
      description: 'Retorna um token CSRF para proteção contra ataques CSRF em formulários.',
      tags: ['Auth'],
      security: [],
      responses: {
        200: {
          description: 'Token CSRF gerado',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  csrfToken: { type: 'string', example: 'a1b2c3d4e5f6...' },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/auth/register': {
    post: {
      summary: 'Registrar novo usuário (admin-only)',
      description: 'Cria uma nova conta de usuário. Exige autenticação de admin/super_admin e CSRF válido.',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password', 'firstName', 'lastName', 'cargo', 'departamento', 'telefone'],
              properties: {
                email: { type: 'string', format: 'email', example: 'usuario@empresa.com' },
                password: { type: 'string', format: 'password', minLength: 8, example: 'SenhaSegura123!' },
                firstName: { type: 'string', minLength: 1, example: 'João' },
                lastName: { type: 'string', minLength: 1, example: 'Silva' },
                cargo: { type: 'string', minLength: 1, example: 'Analista Financeiro' },
                departamento: { type: 'string', minLength: 1, example: 'Financeiro' },
                telefone: { type: 'string', minLength: 6, example: '+55 11 99999-0000' },
                preferredName: { type: 'string', minLength: 2, example: 'João' },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Usuário criado com sucesso',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean', example: true },
                  user: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
        400: { $ref: '#/components/responses/ValidationError' },
        409: { description: 'Email já registrado' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  '/api/auth/login': {
    post: {
      summary: 'Login com email e senha',
      description: 'Autentica usuário e cria sessão.',
      tags: ['Auth'],
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email' },
                password: { type: 'string', format: 'password' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Login bem-sucedido',
          headers: {
            'Set-Cookie': {
              description: 'Cookie de sessão',
              schema: { type: 'string' },
            },
          },
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' },
                  user: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  '/api/auth/biometrics/login': {
    post: {
      summary: 'Login com biometria facial',
      description: 'Autentica usuário via biometria (CPU-only, sem liveness).',
      tags: ['Auth'],
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'imageBase64'],
              properties: {
                email: { type: 'string', format: 'email' },
                imageBase64: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Login bem-sucedido' },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  '/api/auth/biometrics/status': {
    post: {
      summary: 'Status de biometria do usuário',
      tags: ['Auth'],
      responses: {
        200: { description: 'Status retornado' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/biometrics/enroll': {
    post: {
      summary: 'Cadastrar biometria facial',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['imageBase64'],
              properties: {
                imageBase64: { type: 'string' },
                captureMode: { type: 'string', enum: ['replace', 'append'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Biometria cadastrada' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/biometrics/verify': {
    post: {
      summary: 'Verificar biometria facial',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['imageBase64', 'actionType'],
              properties: {
                imageBase64: { type: 'string' },
                actionType: { type: 'string', enum: ['login', 'approval'] },
                actionContext: { type: 'object' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Verificação executada' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/logout': {
    post: {
      summary: 'Encerrar sessão',
      description: 'Faz logout do usuário e invalida a sessão.',
      tags: ['Auth'],
      responses: {
        200: { description: 'Logout bem-sucedido' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/verify-password': {
    post: {
      summary: 'Validar senha do usuário autenticado',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['password'],
              properties: {
                password: { type: 'string', format: 'password' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Senha validada' },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  '/api/auth/change-password': {
    post: {
      summary: 'Alterar senha do usuário autenticado',
      tags: ['Auth'],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['currentPassword', 'newPassword'],
              properties: {
                currentPassword: { type: 'string', format: 'password' },
                newPassword: { type: 'string', format: 'password', minLength: 8 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Senha atualizada' },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },
  '/api/auth/me': {
    get: {
      summary: 'Dados do usuário autenticado',
      description: 'Retorna informações do usuário logado.',
      tags: ['Auth'],
      responses: {
        200: {
          description: 'Dados do usuário',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  authenticated: { type: 'boolean' },
                  user: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/google': {
    get: {
      summary: 'Iniciar OAuth Google',
      description: 'Redireciona para autenticação Google OAuth 2.0.',
      tags: ['OAuth'],
      security: [],
      responses: {
        302: { description: 'Redirect para Google' },
      },
    },
  },
  '/api/auth/google/callback': {
    get: {
      summary: 'Callback OAuth Google',
      description: 'Processa retorno da autenticação Google.',
      tags: ['OAuth'],
      security: [],
      parameters: [
        { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'state', in: 'query', schema: { type: 'string' } },
      ],
      responses: {
        302: { description: 'Redirect para aplicação' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },
  '/api/auth/github': {
    get: {
      summary: 'Iniciar OAuth GitHub',
      description: 'Redireciona para autenticação GitHub OAuth 2.0.',
      tags: ['OAuth'],
      security: [],
      responses: {
        302: { description: 'Redirect para GitHub' },
      },
    },
  },
  '/api/auth/github/callback': {
    get: {
      summary: 'Callback OAuth GitHub',
      description: 'Processa retorno da autenticação GitHub.',
      tags: ['OAuth'],
      security: [],
      parameters: [
        { name: 'code', in: 'query', required: true, schema: { type: 'string' } },
      ],
      responses: {
        302: { description: 'Redirect para aplicação' },
      },
    },
  },
  '/api/auth/saml/azure/metadata': {
    get: {
      summary: 'Metadata SAML Azure AD',
      description: 'Retorna XML de metadata para configuração no Azure AD.',
      tags: ['SAML'],
      security: [],
      responses: {
        200: {
          description: 'XML de metadata',
          content: {
            'application/xml': { schema: { type: 'string' } },
          },
        },
      },
    },
  },
  '/api/auth/saml/azure': {
    get: {
      summary: 'Iniciar login SAML Azure',
      tags: ['SAML'],
      security: [],
      responses: {
        302: { description: 'Redirect para Azure AD' },
      },
    },
  },
  '/api/auth/saml/azure/callback': {
    post: {
      summary: 'Callback SAML Azure',
      tags: ['SAML'],
      security: [],
      requestBody: {
        content: {
          'application/x-www-form-urlencoded': {
            schema: {
              type: 'object',
              properties: {
                SAMLResponse: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        302: { description: 'Redirect para aplicação' },
      },
    },
  },
  '/api/auth/users': {
    get: {
      summary: 'Listar usuários',
      description: 'Lista todos os usuários (requer permissão users:read).',
      tags: ['Users'],
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        { name: 'role', in: 'query', schema: { type: 'string', enum: ['guest', 'user', 'moderator', 'manager', 'admin', 'super_admin'] } },
      ],
      responses: {
        200: {
          description: 'Lista de usuários',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                  pagination: { $ref: '#/components/schemas/Pagination' },
                },
              },
            },
          },
        },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },
  '/api/auth/users/{id}': {
    get: {
      summary: 'Buscar usuário por ID',
      tags: ['Users'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: {
          description: 'Dados do usuário',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/User' },
            },
          },
        },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    patch: {
      summary: 'Atualizar usuário',
      tags: ['Users'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string', enum: ['guest', 'user', 'moderator', 'manager', 'admin', 'super_admin'] },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Usuário atualizado' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    delete: {
      summary: 'Remover usuário',
      tags: ['Users'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        204: { description: 'Usuário removido' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },
  '/api/users/{id}/password': {
    patch: {
      summary: 'Redefinir senha do usuário',
      description: 'Permite que admins redefinam a senha de um usuário do mesmo tenant.',
      tags: ['Users'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['newPassword'],
              properties: {
                newPassword: { type: 'string', minLength: 8, maxLength: 200 },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Senha atualizada com sucesso' },
        400: { $ref: '#/components/responses/BadRequest' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/auth/sessions': {
    get: {
      summary: 'Listar sessões ativas',
      description: 'Lista todas as sessões do usuário autenticado.',
      tags: ['Sessions'],
      responses: {
        200: {
          description: 'Lista de sessões',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  sessions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                        userAgent: { type: 'string' },
                        ip: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/auth/sessions/{sessionId}': {
    delete: {
      summary: 'Revogar sessão',
      tags: ['Sessions'],
      parameters: [
        { name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        204: { description: 'Sessão revogada' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/auth/feature-flags': {
    get: {
      summary: 'Listar feature flags',
      tags: ['Feature Flags'],
      responses: {
        200: {
          description: 'Lista de flags',
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: { type: 'boolean' } },
            },
          },
        },
      },
    },
  },
  '/api/auth/feature-flags/{flagName}': {
    put: {
      summary: 'Atualizar feature flag',
      tags: ['Feature Flags'],
      parameters: [
        { name: 'flagName', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { enabled: { type: 'boolean' } },
            },
          },
        },
      },
      responses: {
        200: { description: 'Flag atualizada' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },
  '/api/auth/rbac/permissions': {
    get: {
      summary: 'Listar permissões do usuário',
      tags: ['RBAC'],
      responses: {
        200: {
          description: 'Lista de permissões',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  role: { type: 'string' },
                  permissions: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/auth/rbac/check': {
    post: {
      summary: 'Verificar permissão',
      tags: ['RBAC'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permission'],
              properties: {
                permission: { type: 'string', example: 'users:write' },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Resultado da verificação',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { allowed: { type: 'boolean' } },
              },
            },
          },
        },
      },
    },
  },
  '/api/auth/permissions': {
    get: {
      summary: 'Listar permissões do sistema',
      tags: ['Permissions'],
      responses: {
        200: {
          description: 'Lista de permissões',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  permissions: { type: 'array', items: { $ref: '#/components/schemas/Permission' } },
                },
              },
            },
          },
        },
      },
    },
    post: {
      summary: 'Criar permissão',
      tags: ['Permissions'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['codigo', 'nome', 'modulo'],
              properties: {
                codigo: { type: 'string' },
                nome: { type: 'string' },
                descricao: { type: 'string' },
                modulo: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Permissão criada' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },
  '/api/auth/permissions/{id}': {
    get: {
      summary: 'Buscar permissão por ID',
      tags: ['Permissions'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Permissão encontrada' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    patch: {
      summary: 'Atualizar permissão',
      tags: ['Permissions'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                nome: { type: 'string' },
                descricao: { type: 'string' },
                modulo: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Permissão atualizada' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      summary: 'Excluir permissão',
      tags: ['Permissions'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Permissão excluída' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/auth/roles/{role}/permissions': {
    get: {
      summary: 'Listar permissões por role',
      tags: ['Permissions'],
      parameters: [
        { name: 'role', in: 'path', required: true, schema: { type: 'string' } },
      ],
      responses: {
        200: { description: 'Permissões da role' },
      },
    },
    put: {
      summary: 'Definir permissões da role',
      tags: ['Permissions'],
      parameters: [
        { name: 'role', in: 'path', required: true, schema: { type: 'string' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['permissionCodes'],
              properties: {
                permissionCodes: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Permissões atualizadas' },
        400: { $ref: '#/components/responses/BadRequest' },
      },
    },
  },
  '/api/auth/groups': {
    get: {
      summary: 'Listar grupos organizacionais',
      tags: ['Groups'],
      responses: {
        200: { description: 'Lista de grupos' },
      },
    },
    post: {
      summary: 'Criar grupo organizacional',
      tags: ['Groups'],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['nome'],
              properties: {
                nome: { type: 'string' },
                descricao: { type: 'string' },
                ativo: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: {
        201: { description: 'Grupo criado' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },
  '/api/auth/groups/{id}': {
    patch: {
      summary: 'Atualizar grupo organizacional',
      tags: ['Groups'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                nome: { type: 'string' },
                descricao: { type: 'string' },
                ativo: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: {
        200: { description: 'Grupo atualizado' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      summary: 'Excluir grupo organizacional',
      tags: ['Groups'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Grupo excluído' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/auth/groups/{id}/users': {
    get: {
      summary: 'Listar membros do grupo',
      tags: ['Groups'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Lista de membros' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    post: {
      summary: 'Adicionar usuário ao grupo',
      tags: ['Groups'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['userId'],
              properties: { userId: { type: 'string', format: 'uuid' } },
            },
          },
        },
      },
      responses: {
        201: { description: 'Usuário adicionado' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/api/auth/groups/{id}/users/{userId}': {
    delete: {
      summary: 'Remover usuário do grupo',
      tags: ['Groups'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],
      responses: {
        200: { description: 'Usuário removido' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
  '/metrics': {
    get: {
      summary: 'Métricas Prometheus',
      tags: ['Health'],
      security: [],
      responses: {
        200: {
          description: 'Métricas no formato Prometheus',
          content: {
            'text/plain': { schema: { type: 'string' } },
          },
        },
      },
    },
  },
};

// Schemas adicionais específicos do auth-service
export const authServiceSchemas = {
  Permission: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      codigo: { type: 'string' },
      nome: { type: 'string' },
      descricao: { type: 'string', nullable: true },
      modulo: { type: 'string' },
      criadoEm: { type: 'string', format: 'date-time' },
    },
  },
  UserGroup: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      nome: { type: 'string' },
      descricao: { type: 'string', nullable: true },
      ativo: { type: 'boolean' },
      criadoPor: { type: 'string', format: 'uuid', nullable: true },
      atualizadoPor: { type: 'string', format: 'uuid', nullable: true },
      criadoEm: { type: 'string', format: 'date-time' },
      atualizadoEm: { type: 'string', format: 'date-time' },
    },
  },
  UserGroupMember: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      tenantId: { type: 'string', format: 'uuid' },
      groupId: { type: 'string', format: 'uuid' },
      userId: { type: 'string', format: 'uuid' },
      criadoPor: { type: 'string', format: 'uuid', nullable: true },
      criadoEm: { type: 'string', format: 'date-time' },
    },
  },
};
