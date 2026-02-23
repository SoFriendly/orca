interface OrcaLogoProps {
  className?: string;
  size?: number;
}

export default function OrcaLogo({ className, size = 32 }: OrcaLogoProps) {
  return <img src="/orca.svg" width={size} height={size} className={className} alt="Orca" draggable={false} />;
}
