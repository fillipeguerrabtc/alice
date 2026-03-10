import { TableCell, TableRow } from '@/components/ui/table';

type TableEmptyRowProps = {
  colSpan: number;
  message: string;
};

export function TableEmptyRow({ colSpan, message }: TableEmptyRowProps) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

