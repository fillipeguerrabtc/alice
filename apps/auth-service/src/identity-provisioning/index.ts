/**
 * Identity Provisioning Module - Alice Enterprise Platform
 * 
 * Sincronização de usuários Alice → Grafana
 * usando Outbox Pattern para garantia de entrega
 * 
 * @author Alice Team
 * @version 1.0.0
 */

export { GrafanaClient, createGrafanaClient } from './grafana-client.js';
export { 
  IdentityProvisioningProcessor,
  publishProvisioningEvent,
  getProcessor,
  startProcessor,
  stopProcessor,
} from './event-processor.js';
