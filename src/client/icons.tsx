/**
 * Line-style toolbar icons (stroke SVGs, currentColor) — deliberately not
 * emoji: they stay quiet next to the rest of the Web Client's chrome and
 * scale cleanly in the rail and tabs.
 * @module dsh-peekedit/client/icons
 */

import type { ReactNode } from 'react'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Folder icon (files tool). */
export function FileIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden {...stroke}>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.8l1.4 1.7h4.8A1.5 1.5 0 0 1 14 5.2v7.3A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9z" />
    </svg>
  )
}

/** Gear icon (tools tool). */
export function ToolsIcon(): ReactNode {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden {...stroke}>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.2v2.1M8 12.7v2.1M1.2 8h2.1M12.7 8h2.1M3.7 3.7l1.5 1.5M10.8 10.8l1.5 1.5M12.3 3.7l-1.5 1.5M5.2 10.8l-1.5 1.5" />
    </svg>
  )
}
