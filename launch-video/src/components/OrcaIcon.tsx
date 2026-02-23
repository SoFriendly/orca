interface OrcaIconProps {
  className?: string;
}

export function OrcaIcon({ className }: OrcaIconProps) {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 1707 1235"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="orca-vid-body" x1="573" y1="1133" x2="988" y2="202" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#24088d"/>
          <stop offset="1" stopColor="#803ffb"/>
        </linearGradient>
        <linearGradient id="orca-vid-belly" x1="698" y1="629" x2="963" y2="304" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4c6778"/>
          <stop offset="1" stopColor="#dbebf6"/>
        </linearGradient>
      </defs>
      <circle cx="810" cy="601" r="549" fill="url(#orca-vid-body)"/>
      <path
        d="M1195,937c-58,61-144,107-262,116-23,2-46,2-66,1-258-11-328-210-332-278-3-41,6-75,29-92,3-2,7-4,10-6,17-8,40-8,70,2,10,165,111,287,337,285,211-1,322-241,298-329,26,81,2,207-86,300Z"
        fill="url(#orca-vid-belly)"
        opacity="0.9"
      />
      <path
        d="M1542,446c-113,18-204,54-193,166-20-114-105-135-222-135-131,0-150-110-150-111,29,39,73,71,202,49,129-22,163,49,163,49,10-25,26-67,147-67s216-74,216-74c1,41-46,104-164,122Z"
        fill="url(#orca-vid-body)"
        opacity="0.85"
      />
      <circle cx="404" cy="391" r="18" fill="currentColor"/>
    </svg>
  );
}
