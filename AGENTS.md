# Algoscope — algorithm visualizer

Vite + React 19 + TypeScript. No router, no CSS framework. Hash routes: `#/` (atlas), `#/algo/<id>`.

## Commands
- `npm run dev` — dev server (port 5173 is taken on this machine; use `npx vite --port 5391`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run check [-- <substring>]` — runs every algorithm generator in Node on default, presets and 25 random inputs; validates notes, code tags, frame counts, parse/format round-trip
- `npm run build`

## Architecture
- `src/core/types.ts` — **the contract** (`AlgorithmDef`, `Frame`, `InputSpec`, `Tone`)
- `src/core/registry.ts` — auto-registers every `src/algorithms/**/*.tsx` default export (no index file to edit). Files starting with `_` are helpers.
- `src/core/player.ts` — frames are precomputed (cap 2500), then played back; `--step-ms` CSS var scales with speed
- `src/core/code.ts` — code listings, `//@tag` / `#@tag` line markers, tiny syntax highlighter
- `src/ui/*` — shell: Sidebar, Home (hero art), AlgorithmPage (stage + narration + code panel w/ breakpoints + watch vars + transport + test-case editor)
- `src/viz/*` — shared SVG primitives (import from `@/viz`)
- `src/styles/{tokens,app,viz}.css` — design tokens & styles
- Reference implementation: `src/algorithms/searching/linear-search.tsx`

## Writing an algorithm (one file: `src/algorithms/<category>/<id>.tsx`)
`export default defineAlgorithm<Input, State>({...})` with:
- `id` (kebab, = filename), `name`, `category` (`basic|searching|sorting|arrays|graphs`), `order`, `tagline`, `description` (supports `**bold**` and `` `code` ``), `howItWorks` (3–5 bullets), `complexity {time, space, note?}`, `legend`, `Glyph`.
- `code: { js, py }` — real, runnable-looking code. Tag lines the visualization highlights by ending them with `//@tag` (js) or `#@tag` (py); several tags: `//@a,b`. **Every tag used in frames must exist in BOTH listings** (checked by `npm run check`). Keep listings ≤ ~30 lines.
- `run(input)` — a generator yielding `Frame<State>`:
  - `state`: a **fresh immutable snapshot** (copy arrays/objects: `[...arr]`, `structuredClone`). Never mutate after yielding.
  - `line`: tag(s) of the code line(s) executing
  - `note`: 1–2 plain-language sentences explaining *why*, not just what. Use **bold** for key values.
  - `vars`: watch panel variables (primitives or small arrays). Keep a stable key set across frames where possible.
  - `phase`: short section label (e.g. "build heap", "extract") — shown as timeline marks
  - Aim for 30–400 frames on the default input. One frame per meaningful action (compare, swap, visit, relax...). First frame = setup, last frame = result.
- `View({ frame, input, index, total })` — pure render of `frame.state`. Compose `@/viz` primitives; use `VizStack`/`VizRow`/`VizSection` for layout, `StatRow` for counters, `Callout` for the final answer.
- `input: InputSpec` — `default`, 2–4 `presets` (incl. edge cases), `random()`, and either `format`+`parse` (single text box; `parse` throws `Error` with a friendly message; must round-trip) or a custom `Editor` component (`{ value, onChange }`) for rich inputs (graphs: `makeGraphEditor(opts)`; grids: `GridEditor`; multi-field forms: write a small Editor using `.field`, `.field-label`, `input` styles). Validate sizes so the picture stays readable.

## Viz primitives (`@/viz`)
- `ArrayView` — cells or bars; items as numbers or `Item {id, value}` (use `withIds()` so swaps **animate by id**); `tones` (map or fn index→Tone), `pointers` (`{index,label,tone,side}`, labels unique per side; index -1 hides), `spans` (brackets), `offsets` (lift items, e.g. `{3:{dy:-64}}` + `reserveLift`), `caption`, `slots`, `maxValue`
- `GraphView` + `Graph {nodes,edges,source,target}` from `graph.ts` (`ek(a,b)` edge keys, `adjacency()`, `randomGraph()`, `circleLayout()`); props: `nodeTones`, `edgeTones`, `edgeLabels`, `nodeBadges` (+`badgeTones`), `nodeSubs`, `rings`, `travelers` (animated dot along an edge; set `replay` to re-fire on the same edge), `dimIdle`, `overlay`, `underlay`. Edges follow node moves (CSS `d` transition).
- `GridView` (`cell(r,c) → {tone|fill,label,labelColor,wall,pulse}`, `path`, `cursor`, `markers`) + `GridEditor` (palette painting, markers, resize, custom actions)
- `TreeView` (forest layout; nodes `{id,label,sub,tone,children,shape}`, `edgeLabels`/`edgeTones` keyed `${parent}-${child}`; positions animate)
- `bits`: `Rich` (`**bold**`, `*italic*`, `` `code` ``), `VizStack`, `VizRow`, `VizSection`, `StatRow`, `Tag`, `Callout`, `TokenStrip` (queues/stacks)
- Tones → colours: idle, active (amber), compare (coral), swap (magenta), done (mint), found (lime), visited (sky), frontier (violet), path (gold), muted, danger. `toneFill(t)` gives the CSS var.

## Style rules
- Aesthetic: midnight drafting table — ink-navy background, cream "paper" text, Instrument Serif display, Space Grotesk UI, JetBrains Mono data. Colour = meaning (use tones consistently).
- Motion: transitions use `var(--step-ms)` and `var(--ease-in-out)` / `var(--ease-out)`; animate `transform`/`opacity` (SVG `fill`/`stroke` OK). Never `transition: all`, never `scale(0)`, no `ease-in`. Respect `prefers-reduced-motion`.
- No CSS file imports from algorithm files (Node check can't load them). Use SVG attributes/inline styles; for bespoke keyframes render a `<style>` element inside your SVG with class names prefixed by the algorithm id.
- `Glyph`: tiny looping SVG (`viewBox="0 0 120 80"`) drawn for the atlas card; use `currentColor` (the category hue) and literal hex colours in SMIL (`<animate>`), since CSS vars don't work in SMIL values.
- Do not edit `src/core`, `src/ui`, `src/viz`, `src/styles` from an algorithm task; put helpers in `src/algorithms/<category>/_<name>.tsx`.
