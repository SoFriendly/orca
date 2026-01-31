import type { CustomThemeColors } from '@/types';

/**
 * Convert hex color to HSL values (without the 'hsl()' wrapper)
 * @param hex - Hex color string (e.g., "#FF6B00" or "FF6B00")
 * @returns HSL string in format "h s% l%" suitable for CSS variables
 */
export function hexToHSL(hex: string): string {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Parse hex values
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Convert HSL string to hex
 * @param hsl - HSL string in format "h s% l%" (e.g., "24 100% 50%")
 * @returns Hex color string with # prefix
 */
export function hslToHex(hsl: string): string {
  const parts = hsl.split(' ');
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Validate hex color format
 */
export function isValidHex(hex: string): boolean {
  return /^#?[0-9A-Fa-f]{6}$/.test(hex);
}

/**
 * Theme default values in HSL format (matching index.css)
 */
export const THEME_DEFAULTS: Record<'dark' | 'tokyo' | 'light', Record<string, string>> = {
  dark: {
    background: '0 0% 7%',
    foreground: '0 0% 90%',
    card: '0 0% 9%',
    cardForeground: '0 0% 90%',
    popover: '0 0% 9%',
    popoverForeground: '0 0% 90%',
    primary: '24 100% 50%',
    primaryForeground: '0 0% 100%',
    secondary: '0 0% 12%',
    secondaryForeground: '0 0% 90%',
    muted: '0 0% 15%',
    mutedForeground: '0 0% 55%',
    accent: '0 0% 15%',
    accentForeground: '0 0% 90%',
    destructive: '0 63% 50%',
    destructiveForeground: '0 0% 100%',
    border: '0 0% 18%',
    input: '0 0% 18%',
    ring: '24 100% 50%',
  },
  tokyo: {
    background: '228 18% 12%',
    foreground: '225 27% 88%',
    card: '228 18% 14%',
    cardForeground: '225 27% 88%',
    popover: '228 18% 14%',
    popoverForeground: '225 27% 88%',
    primary: '252 87% 67%',
    primaryForeground: '0 0% 100%',
    secondary: '228 18% 18%',
    secondaryForeground: '225 27% 88%',
    muted: '228 18% 20%',
    mutedForeground: '225 15% 55%',
    accent: '228 18% 20%',
    accentForeground: '225 27% 88%',
    destructive: '353 80% 60%',
    destructiveForeground: '0 0% 100%',
    border: '228 18% 22%',
    input: '228 18% 22%',
    ring: '252 87% 67%',
  },
  light: {
    background: '0 0% 100%',
    foreground: '222 84% 5%',
    card: '0 0% 100%',
    cardForeground: '222 84% 5%',
    popover: '0 0% 100%',
    popoverForeground: '222 84% 5%',
    primary: '222 47% 11%',
    primaryForeground: '210 40% 98%',
    secondary: '210 40% 96%',
    secondaryForeground: '222 47% 11%',
    muted: '210 40% 96%',
    mutedForeground: '215 16% 47%',
    accent: '210 40% 96%',
    accentForeground: '222 47% 11%',
    destructive: '0 84% 60%',
    destructiveForeground: '210 40% 98%',
    border: '214 32% 91%',
    input: '214 32% 91%',
    ring: '222 84% 5%',
  },
};

/**
 * Convert theme defaults from HSL to hex for a given base theme
 */
export function getThemeDefaultsAsHex(
  baseTheme: 'dark' | 'tokyo' | 'light'
): CustomThemeColors['colors'] {
  const defaults = THEME_DEFAULTS[baseTheme];
  return {
    background: hslToHex(defaults.background),
    foreground: hslToHex(defaults.foreground),
    card: hslToHex(defaults.card),
    cardForeground: hslToHex(defaults.cardForeground),
    popover: hslToHex(defaults.popover),
    popoverForeground: hslToHex(defaults.popoverForeground),
    primary: hslToHex(defaults.primary),
    primaryForeground: hslToHex(defaults.primaryForeground),
    secondary: hslToHex(defaults.secondary),
    secondaryForeground: hslToHex(defaults.secondaryForeground),
    muted: hslToHex(defaults.muted),
    mutedForeground: hslToHex(defaults.mutedForeground),
    accent: hslToHex(defaults.accent),
    accentForeground: hslToHex(defaults.accentForeground),
    destructive: hslToHex(defaults.destructive),
    destructiveForeground: hslToHex(defaults.destructiveForeground),
    border: hslToHex(defaults.border),
    input: hslToHex(defaults.input),
    ring: hslToHex(defaults.ring),
  };
}

/**
 * Generate CSS for the custom theme class
 */
export function generateCustomThemeCSS(colors: CustomThemeColors['colors']): string {
  return `.custom {
  --background: ${hexToHSL(colors.background)};
  --foreground: ${hexToHSL(colors.foreground)};
  --card: ${hexToHSL(colors.card)};
  --card-foreground: ${hexToHSL(colors.cardForeground)};
  --popover: ${hexToHSL(colors.popover)};
  --popover-foreground: ${hexToHSL(colors.popoverForeground)};
  --primary: ${hexToHSL(colors.primary)};
  --primary-foreground: ${hexToHSL(colors.primaryForeground)};
  --secondary: ${hexToHSL(colors.secondary)};
  --secondary-foreground: ${hexToHSL(colors.secondaryForeground)};
  --muted: ${hexToHSL(colors.muted)};
  --muted-foreground: ${hexToHSL(colors.mutedForeground)};
  --accent: ${hexToHSL(colors.accent)};
  --accent-foreground: ${hexToHSL(colors.accentForeground)};
  --destructive: ${hexToHSL(colors.destructive)};
  --destructive-foreground: ${hexToHSL(colors.destructiveForeground)};
  --border: ${hexToHSL(colors.border)};
  --input: ${hexToHSL(colors.input)};
  --ring: ${hexToHSL(colors.ring)};
}`;
}
