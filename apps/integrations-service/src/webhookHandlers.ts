// Blueprint: stripe integration - Webhook Handlers
import { getStripeSync } from './stripeClient';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void> {
    // Validar que payload é Buffer
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'ERRO WEBHOOK STRIPE: Payload deve ser Buffer. ' +
        'Tipo recebido: ' + typeof payload + '. ' +
        'Isso geralmente significa que express.json() processou o body antes deste handler. ' +
        'CORREÇÃO: Registre rota webhook ANTES de app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature, uuid);
  }
}
