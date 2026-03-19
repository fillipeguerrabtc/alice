/**
 * WelcomeScreen - Tela de boas-vindas do Chat
 * 
 * Exibe sugestões de conversação e informações sobre o modelo LLM.
 * 
 * @module Chat/components/WelcomeScreen
 */

import { motion } from 'framer-motion';
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
      className="flex h-full flex-col items-center justify-center px-4 py-12 text-center md:px-6"
    >
      <div className="w-full max-w-2xl space-y-3">
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
          {t('chat.emptyStatePrompt')}
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
          {t('chat.welcomeMessage')}
        </p>
      </div>
    </motion.div>
  );
}
