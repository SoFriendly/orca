import { useState, useEffect } from 'react';
import { useSettingsStore, applyTheme } from '@/stores/settingsStore';
import { ColorInput } from '@/components/ui/color-input';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { RotateCcw, Check } from 'lucide-react';
import { toast } from 'sonner';
import { getThemeDefaultsAsHex } from '@/lib/colorUtils';
import type { CustomThemeColors } from '@/types';

const BASE_THEMES: { id: 'dark' | 'tokyo' | 'light'; name: string }[] = [
  { id: 'tokyo', name: 'Chell Blue' },
  { id: 'dark', name: 'Chell Orange' },
  { id: 'light', name: 'Light' },
];

interface ColorGroup {
  title: string;
  colors: { key: keyof CustomThemeColors['colors']; label: string }[];
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    title: 'Core Colors',
    colors: [
      { key: 'background', label: 'Background' },
      { key: 'foreground', label: 'Foreground' },
      { key: 'primary', label: 'Primary' },
      { key: 'primaryForeground', label: 'Primary Text' },
    ],
  },
  {
    title: 'Surface Colors',
    colors: [
      { key: 'card', label: 'Card' },
      { key: 'cardForeground', label: 'Card Text' },
      { key: 'popover', label: 'Popover' },
      { key: 'popoverForeground', label: 'Popover Text' },
    ],
  },
  {
    title: 'Interactive Colors',
    colors: [
      { key: 'secondary', label: 'Secondary' },
      { key: 'secondaryForeground', label: 'Secondary Text' },
      { key: 'muted', label: 'Muted' },
      { key: 'mutedForeground', label: 'Muted Text' },
      { key: 'accent', label: 'Accent' },
      { key: 'accentForeground', label: 'Accent Text' },
    ],
  },
  {
    title: 'Feedback Colors',
    colors: [
      { key: 'destructive', label: 'Destructive' },
      { key: 'destructiveForeground', label: 'Destructive Text' },
    ],
  },
  {
    title: 'UI Chrome',
    colors: [
      { key: 'border', label: 'Border' },
      { key: 'input', label: 'Input Border' },
      { key: 'ring', label: 'Focus Ring' },
    ],
  },
];

export function CustomThemeEditor() {
  const { customTheme, setCustomTheme } = useSettingsStore();

  // Local state for editing
  const [localColors, setLocalColors] = useState<CustomThemeColors['colors'] | null>(null);
  const [baseTheme, setBaseTheme] = useState<'dark' | 'tokyo' | 'light'>('dark');
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize local state from store
  useEffect(() => {
    if (customTheme) {
      setLocalColors(customTheme.colors);
      setBaseTheme(customTheme.baseTheme);
      setHasChanges(false);
    }
  }, [customTheme]);

  // Handle selecting a base theme (initializes the theme)
  const handleSelectBaseTheme = (theme: 'dark' | 'tokyo' | 'light') => {
    const colors = getThemeDefaultsAsHex(theme);
    setLocalColors(colors);
    setBaseTheme(theme);
    setHasChanges(true);
  };

  // Handle color change (local only, doesn't save)
  const handleColorChange = (key: keyof CustomThemeColors['colors'], value: string) => {
    if (!localColors) return;
    setLocalColors({
      ...localColors,
      [key]: value,
    });
    setHasChanges(true);
  };

  // Apply and save the theme
  const handleApply = () => {
    if (!localColors) return;

    const newCustomTheme: CustomThemeColors = {
      baseTheme,
      colors: localColors,
    };

    // Save to store (persists to localStorage)
    setCustomTheme(newCustomTheme);

    // Apply the theme visually
    applyTheme('custom', newCustomTheme);

    setHasChanges(false);
    toast.success('Custom theme applied');
  };

  // Reset to base theme defaults
  const handleResetToBase = () => {
    const colors = getThemeDefaultsAsHex(baseTheme);
    setLocalColors(colors);
    setHasChanges(true);
  };

  // Preview changes without saving
  const handlePreview = () => {
    if (!localColors) return;
    applyTheme('custom', { baseTheme, colors: localColors });
    toast.success('Preview applied (not saved)');
  };

  // If no local colors yet, show base theme selector
  if (!localColors) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose a base theme to start customizing:
        </p>
        <div className="flex gap-2">
          {BASE_THEMES.map((theme) => (
            <Button
              key={theme.id}
              variant="outline"
              onClick={() => handleSelectBaseTheme(theme.id)}
            >
              {theme.name}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Based on: <span className="font-medium text-foreground">{BASE_THEMES.find(t => t.id === baseTheme)?.name}</span>
          </p>
          <div className="flex gap-1">
            {BASE_THEMES.map((theme) => (
              <Button
                key={theme.id}
                variant={baseTheme === theme.id ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => handleSelectBaseTheme(theme.id)}
              >
                {theme.name}
              </Button>
            ))}
          </div>
        </div>
        <Button
          onClick={handleApply}
          size="sm"
          className="gap-1"
        >
          <Check className="h-3 w-3" />
          Apply Theme
        </Button>
      </div>

      <Accordion type="multiple" defaultValue={['Core Colors']} className="w-full">
        {COLOR_GROUPS.map((group) => (
          <AccordionItem key={group.title} value={group.title}>
            <AccordionTrigger className="py-2 text-sm">
              {group.title}
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-3">
                {group.colors.map((color) => (
                  <ColorInput
                    key={color.key}
                    label={color.label}
                    value={localColors[color.key]}
                    onChange={(value) => handleColorChange(color.key, value)}
                  />
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          onClick={handlePreview}
          disabled={!hasChanges}
        >
          Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetToBase}
          className="gap-1"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </Button>
      </div>
    </div>
  );
}
