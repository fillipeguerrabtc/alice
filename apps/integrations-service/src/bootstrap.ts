/**
 * Bootstrap do Integrations Service
 * 
 * Este arquivo configura process.setMaxListeners ANTES de qualquer import
 * para evitar MaxListenersExceededWarning.
 * 
 * Documentação em PT-BR (Regra 10 replit.md)
 */

// Configurar limite de listeners antes de qualquer módulo ser carregado
process.setMaxListeners(30);

// Importar e executar o serviço principal
import('./index.js');
