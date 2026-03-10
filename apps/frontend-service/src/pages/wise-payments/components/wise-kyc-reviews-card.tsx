import { CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WiseKycTabContentProps } from './wise-kyc-tab-types';

type WiseKycReviewsCardProps = Pick<
  WiseKycTabContentProps,
  'formatDate' | 'isLoadingKycReviews' | 'kycReviews' | 'locale' | 'profileFilter' | 't' | 'timeZone'
>;

export function WiseKycReviewsCard({
  formatDate,
  isLoadingKycReviews,
  kycReviews,
  locale,
  profileFilter,
  t,
  timeZone,
}: WiseKycReviewsCardProps) {
  if (!profileFilter) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.kyc.missingProfile')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoadingKycReviews) {
    return <Skeleton className="h-64" />;
  }

  if (kycReviews.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{t('wise.kyc.noReviews')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>{t('wise.kyc.status')}</TableHead>
            <TableHead>{t('wise.kyc.created')}</TableHead>
            <TableHead>{t('wise.kyc.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {kycReviews.map((review, index) => (
            <TableRow key={review.id ?? `${index}`} data-testid={`row-kyc-${review.id ?? index}`}>
              <TableCell className="font-mono">{review.id ?? '-'}</TableCell>
              <TableCell>{review.status ?? '-'}</TableCell>
              <TableCell>{review.created ? formatDate(review.created, { locale, timeZone }) : '-'}</TableCell>
              <TableCell>{review.updated ? formatDate(review.updated, { locale, timeZone }) : '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
