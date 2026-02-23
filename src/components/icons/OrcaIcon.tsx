interface OrcaIconProps {
  className?: string;
}

export function OrcaIcon({ className }: OrcaIconProps) {
  return <img src="/orca.svg" className={className} alt="" draggable={false} />;
}
