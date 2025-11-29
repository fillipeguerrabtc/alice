/**
 * ActivityItem - Item de atividade recente
 * 
 * @module Dashboard/components/ActivityItem
 */

import { motion } from 'framer-motion';
import { 
  MessageSquare, 
  FileText, 
  Brain, 
  CreditCard, 
  Shield, 
  Activity 
} from 'lucide-react';
import { RecentActivity, itemVariants } from './types';

interface ActivityItemProps {
  activity: RecentActivity;
}

export function ActivityItem({ activity }: ActivityItemProps) {
  const typeIcons: Record<string, typeof MessageSquare> = {
    chat: MessageSquare,
    document: FileText,
    training: Brain,
    payment: CreditCard,
    system: Shield,
  };
  
  const Icon = typeIcons[activity.type || 'system'] || Activity;

  return (
    <motion.div 
      variants={itemVariants}
      className="flex items-center gap-3 p-2 rounded-md hover-elevate"
    >
      <div className="p-2 rounded-full bg-muted">
        <Icon className="h-3 w-3 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{activity.action}</p>
        <p className="text-xs text-muted-foreground">{activity.user}</p>
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {activity.time}
      </span>
    </motion.div>
  );
}
