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
  /** Mínimo de itens selecionados - impede desmarcar abaixo deste limite */
  minSelected?: number;
  emptyLabel?: string;
  placeholder?: string;
  selectedCountLabel?: string;
  maxLabel?: string;
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
  minSelected,
  emptyLabel = 'Nenhuma opção disponível',
  placeholder = 'Selecione...',
  selectedCountLabel = '{count} selecionados',
  maxLabel = 'Máx {max}',
  selectAllLabel = 'Selecionar todos',
  clearLabel = 'Limpar seleção',
  disabled = false,
}: MultiSelectDropdownProps) {
  const resolvedSelectedCountLabel = useMemo(
    () => selectedCountLabel.replace('{count}', String(selectedValues.length)),
    [selectedCountLabel, selectedValues.length]
  );
  const resolvedMaxLabel = useMemo(
    () => maxLabel.replace('{max}', String(maxSelected ?? 0)),
    [maxLabel, maxSelected]
  );
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabel = useMemo(() => {
    if (selectedValues.length === 0) return placeholder;
    if (selectedValues.length === 1) {
      const match = options.find((option) => option.value === selectedValues[0]);
      return match?.label ?? selectedValues[0];
    }
    return resolvedSelectedCountLabel;
  }, [options, placeholder, resolvedSelectedCountLabel, selectedValues]);

  const handleToggle = (value: string, checked: boolean) => {
    const next = new Set(selectedValues);
    if (checked) {
      if (maxSelected && next.size >= maxSelected) return;
      next.add(value);
    } else {
      // Impede desmarcar abaixo do mínimo obrigatório
      if (minSelected && next.size <= minSelected) return;
      next.delete(value);
    }
    onChange(Array.from(next));
  };

  const handleSelectAll = () => {
    if (options.length === 0) return;
    const max = maxSelected ?? options.length;
    onChange(options.slice(0, max).map((option) => option.value));
  };

  const canClear = !minSelected || minSelected <= 0;

  const handleClear = () => {
    if (!canClear) return;
    onChange([]);
  };

  return (
    <div className="space-y-1">
      <DropdownMenu>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {maxSelected ? (
            <span className="text-xs text-muted-foreground">{resolvedMaxLabel}</span>
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
          <DropdownMenuItem
            onClick={handleSelectAll}
            onSelect={(event) => event.preventDefault()}
            disabled={options.length === 0}
          >
            <Check className="h-4 w-4 mr-2 opacity-70" />
            {selectAllLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleClear}
            onSelect={(event) => event.preventDefault()}
            disabled={selectedValues.length === 0 || !canClear}
          >
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
                onSelect={(event) => event.preventDefault()}
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
