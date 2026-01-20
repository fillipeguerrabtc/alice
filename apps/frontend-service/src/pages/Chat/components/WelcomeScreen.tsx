/**
 * WelcomeScreen - Tela de boas-vindas do Chat
 * 
 * Exibe sugestões de conversação e informações sobre o modelo LLM.
 * 
 * @module Chat/components/WelcomeScreen
 */

import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface WelcomeScreenProps {
  onSuggestionClick?: (text: string) => void;
}

export function WelcomeScreen({ onSuggestionClick: _onSuggestionClick }: WelcomeScreenProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center p-6"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring' as const, stiffness: 100 }}
        className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground mb-6 shadow-lg"
      >
        <Bot className="h-10 w-10" />
      </motion.div>
      
      <h2 className="text-2xl font-bold mb-2">
        {t('chat.welcome')}
      </h2>
      <p className="text-muted-foreground max-w-md mb-8">
        {t('chat.welcomeMessage')}
      </p>

      <div className="w-full max-w-lg" />
    </motion.div>
  );
}
