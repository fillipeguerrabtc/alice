import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
  className?: string;
  description?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ className, description, title }: EmptyStateProps) {
  return (
    <div className={cn('py-8 text-center', className)}>
      <p className="text-muted-foreground">{title}</p>
      {description ? (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

