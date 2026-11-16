/** One small icon set: 16px grid, 1.5px stroke, round ends. Every icon in the app comes from here. */
const PATHS = {
  x: "M4 4l8 8M12 4l-8 8",
  back: "M10 3.5L5.5 8 10 12.5",
  next: "M6 3.5L10.5 8 6 12.5",
  external: "M9 3h4v4M13 3L7.5 8.5M11.5 9.5V13h-8.5V4.5H6.5",
  file: "M4 2.5h5l3 3V13.5H4zM9 2.5V5.5h3",
  check: "M3.5 8.5l3 3 6-7",
  plus: "M8 3.5v9M3.5 8h9",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  search: "M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10.6 10.6L14 14",
  sync: "M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5M11.5 2v2.5H14M4.5 14v-2.5H2",
  mail: "M2.5 4h11v8h-11zM2.5 4.5L8 9l5.5-4.5",
  sun: "M8 10.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6zM8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9",
  moon: "M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z",
  auto: "M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12zM8 2v12M8 4.5h4M8 7h5.5M8 9.5h5.5M8 12h4",
  calendar: "M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3",
  clock: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 4.8V8l2.2 1.5",
  folder: "M2 4.5h4.2l1.5 1.6H14v7.4H2z",
  page: "M4 2.5h5.5l2.5 2.5v8.5H4zM6 7.5h4M6 10h4",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6",
  tool: "M9.5 2.5a3 3 0 0 0-2.8 4L2.8 10.4a1.3 1.3 0 0 0 1.8 1.8l3.9-3.9a3 3 0 0 0 4-2.8l-1.7 1.2-1.6-.4-.4-1.6z",
  assignment: "M5.5 2.5h5v2h-5zM4 3.5h8v10H4zM6 8.5l1.5 1.5 2.7-3",
  test: "M3 3h10v10H3zM5.5 8.2l1.8 1.8 3.3-3.6",
  discussion: "M2.5 3.5h11v7H8l-3 2.5v-2.5H2.5z",
  book: "M8 4.2C6.8 3.4 4.8 3 2.5 3.2v9c2.3-.2 4.3.2 5.5 1 1.2-.8 3.2-1.2 5.5-1v-9C11.2 3 9.2 3.4 8 4.2zM8 4.2v9",
  download: "M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10",
  copy: "M5.5 5.5h7v7h-7zM10.5 5.5v-2h-7v7h2",
  user: "M8 8a2.6 2.6 0 1 0 0-5.2A2.6 2.6 0 0 0 8 8zM3 13.5c.6-2.5 2.6-3.8 5-3.8s4.4 1.3 5 3.8",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
