import * as React from 'react';
import { cn } from '@/lib/utils';
import { isValidHex } from '@/lib/colorUtils';

export interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const ColorInput = React.forwardRef<HTMLDivElement, ColorInputProps>(
  ({ label, value, onChange, className }, ref) => {
    const [inputValue, setInputValue] = React.useState(value);
    const [isValid, setIsValid] = React.useState(true);

    React.useEffect(() => {
      setInputValue(value);
      setIsValid(true);
    }, [value]);

    const handleColorPickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      setIsValid(true);
      onChange(newValue);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let newValue = e.target.value;

      // Add # prefix if missing
      if (newValue && !newValue.startsWith('#')) {
        newValue = '#' + newValue;
      }

      setInputValue(newValue);

      if (isValidHex(newValue)) {
        setIsValid(true);
        onChange(newValue.toUpperCase());
      } else {
        setIsValid(newValue === '' || newValue === '#');
      }
    };

    const handleTextBlur = () => {
      // Reset to last valid value on blur if invalid
      if (!isValidHex(inputValue)) {
        setInputValue(value);
        setIsValid(true);
      }
    };

    return (
      <div ref={ref} className={cn('flex items-center gap-2', className)}>
        <input
          type="color"
          value={value}
          onChange={handleColorPickerChange}
          className="h-8 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        <input
          type="text"
          value={inputValue}
          onChange={handleTextChange}
          onBlur={handleTextBlur}
          placeholder="#000000"
          className={cn(
            'w-20 rounded-md border bg-background px-2 py-1 font-mono text-xs',
            isValid ? 'border-input' : 'border-destructive'
          )}
        />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    );
  }
);

ColorInput.displayName = 'ColorInput';

export { ColorInput };
