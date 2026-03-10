import {
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function getWiseStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'outgoing_payment_sent':
    case 'funds_converted':
      return <Badge variant="default" className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Completed</Badge>;
    case 'processing':
    case 'incoming_payment_waiting':
    case 'waiting_recipient_input_to_proceed':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Processing</Badge>;
    case 'cancelled':
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Cancelled</Badge>;
    case 'failed':
    case 'bounced_back':
      return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
