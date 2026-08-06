/**
 * 线描图标。刻意不用 emoji：emoji 在不同系统上是不同的画风，
 * 而且颜色写死，跟不了深浅主题。
 */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconRefresh() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.8}>
      <path d="M20 11a8 8 0 1 0-2.3 6" /><path d="M20 5v6h-6" />
    </svg>
  );
}

export function IconCaret() {
  return (
    <svg className="caret" width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 4l10 8-10 8z" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <path d="M4 12.5l5.5 5.5L20 6.5" />
    </svg>
  );
}

export function IconCross() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function IconId() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2.2" />
      <path d="M5.5 16.5c.8-1.6 2-2.4 3.5-2.4s2.7.8 3.5 2.4M15 10h4M15 13.5h3" />
    </svg>
  );
}

export function IconGlobe() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15 0 18M12 3c-2.5 2.6-2.5 15 0 18" />
    </svg>
  );
}

export function IconDoc() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h4" />
    </svg>
  );
}

export function IconLoading() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <circle cx="12" cy="12" r="9" opacity=".25" />
      <path className="spin" d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}

export function IconPlug() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.6}>
      <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" />
    </svg>
  );
}

export function IconPath() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <path d="M4 6h5l1.5 2H20v10H4z" />
      <path d="M8 12h8M8 15.5h5" />
    </svg>
  );
}

export function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-2.5v8l-5-2.5z" />
    </svg>
  );
}

export function IconBrowse() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </svg>
  );
}

export function IconGear() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.07a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}
