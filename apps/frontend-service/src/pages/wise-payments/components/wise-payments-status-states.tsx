import { AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

type WisePaymentsNotConfiguredStateProps = {
  description: string;
  title: string;
};

export function WisePaymentsLoadingState() {
  return (
    <div className="p-6 space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export function WisePaymentsNotConfiguredState({
  description,
  title,
}: WisePaymentsNotConfiguredStateProps) {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">{title}</h3>
          <p className="text-muted-foreground text-center max-w-md">{description}</p>
        </CardContent>
      </Card>
    </div>
  );
}
