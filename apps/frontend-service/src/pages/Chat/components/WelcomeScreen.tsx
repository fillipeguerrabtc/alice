/**
 * WelcomeScreen - Tela de boas-vindas do Chat
 * 
 * Exibe sugestões de conversação e informações sobre o modelo LLM.
 * 
 * @module Chat/components/WelcomeScreen
 */

import { motion } from 'framer-motion';
import { Bot, Sparkles, FileText, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

interface WelcomeScreenProps {
  onSuggestionClick?: (text: string) => void;
}

export function WelcomeScreen({ onSuggestionClick }: WelcomeScreenProps) {
  const { t } = useTranslation();
  
  const suggestions = [
    { 
      icon: Sparkles, 
      text: t('chat.suggestions.explain') 
    },
    { 
      icon: FileText, 
      text: t('chat.suggestions.write') 
    },
    { 
      icon: Settings, 
      text: t('chat.suggestions.configure') 
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center p-6"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 100 }}
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

      <div className="grid gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            onClick={() => onSuggestionClick?.(suggestion.text)}
            data-testid={`button-suggestion-${index}`}
            className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 hover-elevate text-left transition-colors"
          >
            <div className="p-2 rounded-md bg-primary/10">
              <suggestion.icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm">{suggestion.text}</span>
          </motion.button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-8">
        <Badge variant="outline" className="text-xs">
          {t('chat.modelName')}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t('chat.modelParams')}
        </Badge>
        <Badge variant="outline" className="text-xs">
          {t('chat.ragIntegrated')}
        </Badge>
      </div>
    </motion.div>
  );
}
