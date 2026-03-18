/**
 * WelcomeScreen - Tela de boas-vindas do Chat
 * 
 * Exibe sugestões de conversação e informações sobre o modelo LLM.
 * 
 * @module Chat/components/WelcomeScreen
 */

import { motion } from 'framer-motion';
import { Bot, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
      className="flex h-full flex-col items-center justify-center px-4 py-10 text-center md:px-6"
    >
      <div className="w-full max-w-2xl rounded-[2rem] border border-border/60 bg-background/80 px-6 py-10 shadow-[0_24px_80px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl md:px-10">
        <Badge
          variant="outline"
          className="mb-5 rounded-full border-border/70 bg-background/70 px-3 py-1 text-[11px] font-medium text-muted-foreground"
        >
          <Sparkles className="mr-1.5 h-3 w-3 text-primary/70" />
          Chat Alice
        </Badge>

        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring' as const, stiffness: 100 }}
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-gradient-to-br from-primary/95 via-primary to-primary/70 text-primary-foreground shadow-lg"
        >
          <Bot className="h-10 w-10" />
        </motion.div>

        <h2 className="mb-3 text-3xl font-semibold tracking-tight">
          {t('chat.welcome')}
        </h2>
        <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
          {t('chat.welcomeMessage')}
        </p>
      </div>
    </motion.div>
  );
}
