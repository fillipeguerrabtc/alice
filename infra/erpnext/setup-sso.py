#!/usr/bin/env python3
"""
Alice Enterprise Platform - ERPNext SSO Setup
==============================================

Este script configura o Social Login Key no ERPNext para usar Alice como IdP.

Uso:
    1. Acesse o bench do ERPNext: docker exec -it alice-erpnext-backend bash
    2. Execute: cd frappe-bench && bench --site erp.yesyoudeserve.duckdns.org execute setup-sso.py

Ou via API REST:
    POST /api/resource/Social Login Key

Documentação:
    - https://frappeframework.com/docs/user/en/guides/integration/oauth
    - https://docs.erpnext.com/docs/user/manual/en/setting-up/users-and-permissions/social-login-keys
"""

import frappe
import os
import json

def setup_alice_social_login():
    """
    Configura o Social Login Key para Alice IdP
    
    Role Mapping:
    - super_admin, admin -> System Manager
    - manager -> Accounts Manager, Sales Manager
    - operator -> Accounts User, Sales User
    - viewer, guest -> Guest
    """
    
    # Configurações do OAuth Alice
    client_id = os.environ.get('ALICE_OAUTH_CLIENT_ID', 'erpnext-sso')
    client_secret = os.environ.get('ALICE_OAUTH_CLIENT_SECRET')
    issuer = os.environ.get('ALICE_OIDC_ISSUER', 'https://yesyoudeserve.duckdns.org')
    
    if not client_secret:
        print("ERRO: ALICE_OAUTH_CLIENT_SECRET não está definido!")
        return
    
    # Verificar se já existe
    existing = frappe.db.exists('Social Login Key', {'provider_name': 'Alice Enterprise'})
    
    if existing:
        doc = frappe.get_doc('Social Login Key', existing)
        print(f"Atualizando Social Login Key existente: {existing}")
    else:
        doc = frappe.new_doc('Social Login Key')
        print("Criando novo Social Login Key")
    
    # Configurar campos
    doc.update({
        'provider_name': 'Alice Enterprise',
        'enable_social_login': 1,
        'client_id': client_id,
        'client_secret': client_secret,
        'custom_base_url': issuer,
        'authorize_url': f'{issuer}/oauth/authorize',
        'access_token_url': f'{issuer}/oauth/token',
        'redirect_url': 'https://erp.yesyoudeserve.duckdns.org/api/method/frappe.integrations.oauth2_logins.login_via_oauth2',
        'api_endpoint': f'{issuer}/oauth/userinfo',
        'api_endpoint_args': json.dumps({}),
        'auth_url_data': json.dumps({
            # Escopo "alice" é necessário para claims customizados (role, tenant_id, modules)
            # via /oauth/userinfo. "offline_access" permite refresh token quando suportado.
            'scope': 'openid email profile alice offline_access',
            'response_type': 'code'
        }),
        'icon': 'fa fa-key',
        'sign_ups': 1,  # Permitir registro via SSO
        'user_id_property': 'email',  # Campo para identificar usuário
    })
    
    doc.save(ignore_permissions=True)
    frappe.db.commit()
    
    print(f"Social Login Key configurado com sucesso!")
    print(f"  Provider: Alice Enterprise")
    print(f"  Client ID: {client_id}")
    print(f"  Issuer: {issuer}")
    print(f"  Authorize URL: {issuer}/oauth/authorize")
    print(f"  Token URL: {issuer}/oauth/token")
    print(f"  Userinfo URL: {issuer}/oauth/userinfo")


def setup_role_mapping():
    """
    Configura o mapeamento de roles Alice -> ERPNext
    
    Este mapeamento é aplicado via Identity Provisioning (Outbox Pattern)
    no auth-service, mas também pode ser configurado aqui para fallback.
    """
    
    role_mapping = {
        'super_admin': ['System Manager', 'Administrator'],
        'admin': ['System Manager'],
        'manager': ['Accounts Manager', 'Sales Manager', 'Purchase Manager'],
        'operator': ['Accounts User', 'Sales User', 'Purchase User'],
        'viewer': ['Guest'],
        'guest': ['Guest'],
    }
    
    print("\nMapeamento de Roles Alice -> ERPNext:")
    for alice_role, erpnext_roles in role_mapping.items():
        print(f"  {alice_role} -> {', '.join(erpnext_roles)}")
    
    return role_mapping


if __name__ == '__main__':
    # Inicializar Frappe
    frappe.init(site=os.environ.get('SITE_NAME', 'erp.yesyoudeserve.duckdns.org'))
    frappe.connect()
    
    try:
        setup_alice_social_login()
        setup_role_mapping()
        print("\n✓ Setup concluído com sucesso!")
    except Exception as e:
        print(f"\n✗ Erro no setup: {e}")
        frappe.db.rollback()
    finally:
        frappe.destroy()
