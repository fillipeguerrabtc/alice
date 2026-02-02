import { useMemo } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type Option = {
  value: string;
  label: string;
};

type MultiSelectDropdownProps = {
  label: string;
  options: Option[];
  selectedValues: string[];
  onChange: (next: string[]) => void;
  maxSelected?: number;
  emptyLabel?: string;
  placeholder?: string;
  selectAllLabel?: string;
  clearLabel?: string;
  disabled?: boolean;
};

export function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  maxSelected,
  emptyLabel = 'Nenhuma opção disponível',
  placeholder = 'Selecione...',
  selectAllLabel = 'Selecionar todos',
  clearLabel = 'Limpar seleção',
  disabled = false,
}: MultiSelectDropdownProps) {
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabel = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      const match = options.find((option) => option.value === selectedValues[0]);
      return match?.label ?? selectedValues[0];
    }
    return `${selectedValues.length} selecionados`;
  }, [options, selectedValues]);

  const handleToggle = (value: string, checked: boolean) => {
    const next = new Set(selectedValues);
    if (checked) {
      if (maxSelected && next.size >= maxSelected) return;
      next.add(value);
    } else {
      next.delete(value);
    }
    onChange(Array.from(next));
  };

  const handleSelectAll = () => {
    if (options.length === 0) return;
    const max = maxSelected ?? options.length;
    onChange(options.slice(0, max).map((option) => option.value));
  };

  const handleClear = () => {
    onChange([]);
  };

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {maxSelected ? (
            <span className="text-xs text-muted-foreground">Máx {maxSelected}</span>
          ) : null}
        </div>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="outline" className="w-full justify-between">
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown className="h-4 w-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72 max-h-64">
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSelectAll} disabled={options.length === 0}>
            <Check className="h-4 w-4 mr-2 opacity-70" />
            {selectAllLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleClear} disabled={selectedValues.length === 0}>
            {clearLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.length === 0 ? (
            <DropdownMenuItem disabled>{emptyLabel}</DropdownMenuItem>
          ) : (
            options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selectedSet.has(option.value)}
                onCheckedChange={(checked) => handleToggle(option.value, Boolean(checked))}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
