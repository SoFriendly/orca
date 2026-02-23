import { useSettingsStore } from "@/stores/settingsStore";

interface OrcaIconProps {
  className?: string;
}

const LOGO_BASE_HUE = 255;

function getThemeHueRotation(theme: string): number {
  switch (theme) {
    case "tokyo": return 130;
    default: return 0;
  }
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

export function OrcaIcon({ className }: OrcaIconProps) {
  const theme = useSettingsStore((s) => s.theme);
  const customTheme = useSettingsStore((s) => s.customTheme);

  let rotation = getThemeHueRotation(theme);
  if (theme === "custom" && customTheme) {
    rotation = hexToHue(customTheme.colors.primary) - LOGO_BASE_HUE;
  }

  const filter = rotation !== 0 ? `hue-rotate(${rotation}deg)` : undefined;

  return <img src="/orca.svg" className={className} alt="" draggable={false} style={filter ? { filter } : undefined} />;
}
