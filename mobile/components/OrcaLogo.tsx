import Svg, { Path, Circle, Ellipse } from "react-native-svg";
import { useTheme } from "./ThemeProvider";

interface OrcaLogoProps {
  size?: number;
  color?: string;
}

export default function OrcaLogo({ size = 32, color }: OrcaLogoProps) {
  const { colors } = useTheme();
  const bodyColor = color || "#6e56cf";
  const bellyColor = "#dbebf6";

  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      {/* Orca body silhouette */}
      <Path
        d="M6 18C6 12 10 6 18 6C24 6 28 10 28 16C28 22 24 28 16 28C10 28 6 24 6 18Z"
        fill={bodyColor}
      />
      {/* Dorsal fin */}
      <Path
        d="M17 6L19 2L21 6"
        fill={bodyColor}
      />
      {/* Tail fluke */}
      <Path
        d="M6 18L3 15L4 19L3 23L6 20"
        fill={bodyColor}
      />
      {/* Belly patch */}
      <Ellipse
        cx="20"
        cy="19"
        rx="5"
        ry="4"
        fill={bellyColor}
      />
      {/* Eye */}
      <Circle cx="23" cy="12" r="1.5" fill="white" />
    </Svg>
  );
}
