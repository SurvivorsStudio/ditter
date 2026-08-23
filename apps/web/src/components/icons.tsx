import type { JSX } from 'react'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Icon = {
  home: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  flow: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M9 6h6a3 3 0 0 1 3 3v6" />
    </svg>
  ),
  chart: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  ),
  db: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    </svg>
  ),
  stack: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  clock: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  bolt: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
    </svg>
  ),
  filter: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 7h16M7 12h10M10 17h4" />
    </svg>
  ),
  map: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 12h5l3-7 4 14 3-7h3" />
    </svg>
  ),
  code: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M9 8l-4 4 4 4" />
      <path d="M15 8l4 4-4 4" />
    </svg>
  ),
  expand: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M8 3H3v5" />
      <path d="M21 8V3h-5" />
      <path d="M16 21h5v-5" />
      <path d="M3 16v5h5" />
    </svg>
  ),
  compress: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 8h5V3" />
      <path d="M21 8h-5V3" />
      <path d="M16 21v-5h5" />
      <path d="M8 21v-5H3" />
    </svg>
  ),
  branch: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M5 4v6a4 4 0 0 0 4 4h10" />
      <path d="M5 20v-6" />
      <path d="M16 10l3 4-3 4" />
    </svg>
  ),
  chevron: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  check: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M5 12l5 5L20 6" />
    </svg>
  ),
  table: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="4.5" y="5" width="3.4" height="14" rx="1.3" />
      <rect x="10.3" y="5" width="3.4" height="14" rx="1.3" />
      <rect x="16.1" y="5" width="3.4" height="14" rx="1.3" />
    </svg>
  ),
  cloud: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
    </svg>
  ),
  file: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  ),
  note: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M4 4h16v11l-5 5H4z" />
      <path d="M20 15h-5v5" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  ),
  folder: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  frame: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" strokeDasharray="3 3" />
      <path d="M3 9h18" />
    </svg>
  ),
  sap: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M7 13h4M7 16h7" />
    </svg>
  ),
  leaf: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 2c3 3.5 4.5 6.5 4.5 9.5A4.5 4.5 0 0 1 12 16a4.5 4.5 0 0 1-4.5-4.5C7.5 8.5 9 5.5 12 2z" />
      <path d="M12 16v6" />
    </svg>
  ),
  play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  star: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9z" />
    </svg>
  ),
  plus: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  split: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  ),
  panelLeft: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M5.5 8h1.5M5.5 11h1.5" />
    </svg>
  ),
  merge: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </svg>
  ),
  edit: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  copy: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  alert: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  refresh: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" />
    </svg>
  ),
  save: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  ),
  trash: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  ),
  stop: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  pause: () => (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ),
  // CDC(실시간 스트림) — 방송 신호 모양
  broadcast: () => (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M6 6a8 8 0 0 0 0 12M18 6a8 8 0 0 1 0 12" />
    </svg>
  ),
} satisfies Record<string, () => JSX.Element>

export type IconName = keyof typeof Icon
