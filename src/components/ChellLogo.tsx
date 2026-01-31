import { cn } from "@/lib/utils";

interface ChellLogoProps {
  className?: string;
  size?: number;
}

export default function ChellLogo({ className, size = 32 }: ChellLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
    >
      {/* Terminal prompt > on the left */}
      <path
        d="M3 11L9 16L3 21"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* 4 nodes forming a C shape */}
      <circle cx="26" cy="7" r="3" fill="currentColor" />
      <circle cx="18" cy="11" r="3" fill="currentColor" />
      <circle cx="18" cy="21" r="3" fill="currentColor" />
      <circle cx="26" cy="25" r="3" fill="currentColor" />
    </svg>
  );
}
