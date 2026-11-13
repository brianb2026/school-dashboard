# Design

**Feel:** an operations console that's calm enough for school. Dense and scannable like a dashboard, warm and color-coded like a planner. Nothing should look aggressive or "generated".

## Rules

- **Type:** IBM Plex Sans for UI, IBM Plex Mono with tabular figures for numbers, dates, times and grades. Bundled locally (no font CDN). Sizes: 13 px panel titles, 14 px body, 12 px meta, 28 px headline numbers.
- **Surfaces:** flat. 1 px hairline borders, 6 px radius, no shadows except menus. **No gradients, no glows, no neon, no glassmorphism.**
- **Color:** dark slate base (not pure black) with a light theme that follows the system. One calm accent (dusty blue). Seven muted course colors (clay, ochre, sage, teal, slate blue, heather, rose), used only as small swatches, chips and thin bars, never as big fills.
- **Status:** red (late), amber (due soon/conflict), green (done), shown as text-colored tags with tinted borders, not filled badges.
- **Heatmap:** one hue in five discrete steps; conflict days get an amber outline.
- **Layout:** top bar (term, ⌘K search, sync status) · left rail (views + course list) · 12-column panel grid that collapses to one column under 1100 px.
- **Copy:** plain and short. "Due next", "Workload, next 14 days". No emoji in the UI chrome.
- **Help:** every panel can carry a short "what is this" line; empty states explain what to connect.

Tokens: `apps/web/src/styles/tokens.css`.
