import { useSettingsStore } from "@/stores/settingsStore";

interface OrcaLogoProps {
  className?: string;
  size?: number;
}

// The logo SVG base hue is ~255 (violet/purple).
// We compute hue-rotate to shift it to match the theme's primary color.
const LOGO_BASE_HUE = 255;

function getThemeHueRotation(theme: string): number {
  switch (theme) {
    case "dark": return 0;       // Purple — matches logo natively
    case "tokyo": return 130;    // Orange/red — rotate to ~25 hue
    case "light": return 0;      // Purple — matches logo
    default: return 0;
  }
}

export default function OrcaLogo({ className, size = 32 }: OrcaLogoProps) {
  const theme = useSettingsStore((s) => s.theme);
  const customTheme = useSettingsStore((s) => s.customTheme);

  let rotation = getThemeHueRotation(theme);

  // For custom themes, compute rotation from the custom primary color's hue
  if (theme === "custom" && customTheme) {
    const hex = customTheme.colors.primary;
    const hue = hexToHue(hex);
    rotation = hue - LOGO_BASE_HUE;
  }

  const filter = rotation !== 0 ? `hue-rotate(${rotation}deg)` : undefined;

  return (
    <img
      src="/OrcaIcon.svg"
      width={size}
      height={size}
      className={className}
      alt="Orca"
      draggable={false}
      style={filter ? { filter } : undefined}
    />
  );
}

function hexToHue(hex: string): number {
  hex = hex.replace(/^#/, "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return Math.round(h * 360);
}
