/**
 * Testes unitários para o trading-command-parser
 *
 * Valida:
 * - "mercado" NÃO é mais mapeado para status (B1)
 * - Comandos somente-leitura não requerem confirmação (B2 - testado indiretamente via parser)
 * - Comandos existentes continuam funcionando
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

import { describe, it, expect } from 'vitest';
import { parseTradingCommand, isTradingCommand } from '../../apps/chat-service/src/trading-command-parser';

describe('parseTradingCommand', () => {
  describe('B1 - "mercado" não deve mapear para status', () => {
    it('deve reconhecer "como está o trading" como status', () => {
      const result = parseTradingCommand('como está o trading');
      expect(result.type).toBe('status');
      expect(result.isTrading).toBe(true);
    });

    it('deve reconhecer "como está o bot" como status', () => {
      const result = parseTradingCommand('como está o bot');
      expect(result.type).toBe('status');
      expect(result.isTrading).toBe(true);
    });

    it('deve reconhecer "situação do trading" como status', () => {
      const result = parseTradingCommand('situação do trading');
      expect(result.type).toBe('status');
      expect(result.isTrading).toBe(true);
    });

    it('NÃO deve reconhecer "como está o mercado cripto hoje" como trading command', () => {
      const result = parseTradingCommand('como está o mercado cripto hoje');
      expect(result.type).toBe('unknown');
      expect(result.isTrading).toBe(false);
    });

    it('NÃO deve reconhecer "como está o mercado" como trading command', () => {
      const result = parseTradingCommand('como está o mercado');
      expect(result.type).toBe('unknown');
    });

    it('isTradingCommand deve retornar false para perguntas sobre mercado', () => {
      expect(isTradingCommand('como está o mercado cripto hoje')).toBe(false);
    });

    it('isTradingCommand deve retornar true para status do trading', () => {
      expect(isTradingCommand('status do trading')).toBe(true);
    });
  });

  describe('Comandos existentes continuam funcionando', () => {
    it('deve reconhecer "compre 5 BTC" como buy', () => {
      const result = parseTradingCommand('compre 5 BTC');
      expect(result.type).toBe('buy');
      expect(result.amount).toBe(5);
    });

    it('deve reconhecer "venda 3 BTC" como sell', () => {
      const result = parseTradingCommand('venda 3 BTC');
      expect(result.type).toBe('sell');
      expect(result.amount).toBe(3);
    });

    it('deve reconhecer "status do trading" como status', () => {
      const result = parseTradingCommand('status do trading');
      expect(result.type).toBe('status');
      expect(result.isTrading).toBe(true);
    });

    it('deve reconhecer "minhas posições" como positions', () => {
      const result = parseTradingCommand('minhas posições');
      expect(result.type).toBe('positions');
    });

    it('deve reconhecer "minhas ordens" como orders', () => {
      const result = parseTradingCommand('minhas ordens');
      expect(result.type).toBe('orders');
    });

    it('deve reconhecer "gerar sinal" como generate_signal', () => {
      const result = parseTradingCommand('gerar sinal');
      expect(result.type).toBe('generate_signal');
    });

    it('deve reconhecer pedido de scalping como generate_signal', () => {
      const result = parseTradingCommand('verifique principais criptos e veja se temos oportunidades de scalping agora');
      expect(result.type).toBe('generate_signal');
      expect(result.isTrading).toBe(true);
      expect(isTradingCommand('verifique principais criptos e veja se temos oportunidades de scalping agora')).toBe(true);
    });

    it('deve reconhecer tecnica generica com contexto de trading (swing trade)', () => {
      const message = 'quero oportunidades de swing trade para crypto hoje';
      const result = parseTradingCommand(message);
      expect(result.type).toBe('generate_signal');
      expect(result.isTrading).toBe(true);
      expect(isTradingCommand(message)).toBe(true);
    });

    it('deve reconhecer tecnica generica com contexto de trading (day trade)', () => {
      const message = 'analise btc e mostre setups de day trade';
      const result = parseTradingCommand(message);
      expect(result.type).toBe('generate_signal');
      expect(result.isTrading).toBe(true);
      expect(isTradingCommand(message)).toBe(true);
    });

    it('nao deve classificar pedido generico sem contexto de trading', () => {
      const message = 'quais oportunidades de carreira existem hoje?';
      const result = parseTradingCommand(message);
      expect(result.type).toBe('unknown');
      expect(result.isTrading).toBe(false);
      expect(isTradingCommand(message)).toBe(false);
    });

    it('deve reconhecer "análise técnica" como analysis', () => {
      const result = parseTradingCommand('análise técnica do btc');
      expect(result.type).toBe('analysis');
    });

    it('deve filtrar perguntas informativas sobre preço via isTradingCommand', () => {
      expect(isTradingCommand('qual o preço do bitcoin')).toBe(false);
      expect(isTradingCommand('cotação do BTC')).toBe(false);
    });
  });
});
