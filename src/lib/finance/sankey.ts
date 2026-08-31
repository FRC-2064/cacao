/**
 * Sankey layout: pure geometry, no SVG elements and no Svelte. Returns
 * coordinates and path strings for a component to render.
 *
 * Three columns — income sources, a single season total, spend categories —
 * built as a proper flow graph and laid out with d3-sankey, which conserves
 * flow (every unit in a node's incoming links equals its outgoing links).
 *
 * A season's two sides rarely add up to the same number: it raised more than
 * it spent, or dipped into savings to spend more than it raised. Rather than
 * scale the two sides independently (which silently discards the difference
 * as an invisible, unbalanced diagram), we make the difference an explicit
 * node — `Retained` on the outgoing side for a surplus, `Drawn from
 * reserves` on the incoming side for a shortfall — so the graph always
 * balances and nothing just vanishes.
 */

import { sankey, sankeyLinkHorizontal } from 'd3-sankey';

export interface SankeyCategory {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface SankeyInput {
  incoming: SankeyCategory[];
  outgoing: SankeyCategory[];
  width: number;
  height: number;
}

export interface SankeyNode {
  /**
   * Unique graph key: `in:<categoryId>`, `out:<categoryId>`, or the total
   * node. A category id alone is NOT unique -- the same id (e.g.
   * `uncategorized`) can appear on both the incoming and outgoing side, so
   * identity has to be a (column, category) pair, not the category id.
   */
  id: string;
  /** The raw category id (or synthetic sentinel), e.g. `uncategorized`. Not
   *  guaranteed unique across the whole node list -- see `id`. */
  categoryId: string;
  label: string;
  value: number;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Vertical midpoint of the node bar. */
  centerY: number;
  /**
   * Where the label is actually drawn. Equal to centerY unless a collision
   * pass had to push it down to keep it clear of a neighbour's label.
   */
  labelY: number;
  column: 'in' | 'total' | 'out';
  /** True for the synthetic Retained / Drawn from reserves node. Never a real spend or income category. */
  synthetic: boolean;
}

export interface SankeyLink {
  id: string;
  from: string;
  to: string;
  path: string;
  width: number;
  color: string;
}

export interface SankeyLayout {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIn: number;
  totalOut: number;
  /**
   * The canvas height the caller must draw to fit every label. Equal to the
   * requested height in the ordinary case; taller only when a column holds
   * more labels than MIN_LABEL_GAP spacing can seat, which would otherwise
   * clip the overhang off the bottom of the SVG.
   */
  contentHeight: number;
}

const NODE_WIDTH = 14;
const NODE_PADDING = 10;

/**
 * Vertical room reserved above/below the plotted extent so a two-line label
 * anchored on the topmost or bottommost node never runs past the canvas
 * edge. The bottom inset is larger to leave room for the second tspan line
 * (rendered at dy="14") plus its own text height.
 */
const LABEL_INSET_TOP = 8;
const LABEL_INSET_BOTTOM = 28;

/**
 * Minimum vertical gap between two label anchors in the same column. Below
 * this, a two-line, 12px label would visually run into its neighbour.
 */
export const MIN_LABEL_GAP = 28;

const TOTAL_ID = '__total__';
const RETAINED_ID = '__retained__';
const DRAWN_ID = '__drawn_from_reserves__';
const RETAINED_LABEL = 'Retained';
const DRAWN_LABEL = 'Drawn from reserves';
const MUTED_COLOR = 'var(--color-flow-muted)';

type Column = 'in' | 'total' | 'out';

/**
 * A d3-sankey node has to be keyed by graph identity, not by category id: the
 * same category id can appear on both the incoming and outgoing side (e.g.
 * `uncategorized` is a key in both INCOME_CATEGORY_META and
 * EXPENSE_CATEGORY_META), and giving both sides the same node id would create
 * a two-node cycle (`x -> Total` and `Total -> x`) that d3-sankey rejects.
 * Namespacing by column makes a node's identity a (column, categoryId) pair,
 * which is always unique.
 */
const graphNodeId = (column: 'in' | 'out', categoryId: string) => `${column}:${categoryId}`;

/** The node datum shape fed into d3-sankey; d3 adds x0/x1/y0/y1/value in place. */
interface NodeDatum {
  id: string;
  /** The raw category id (or synthetic sentinel) this node represents. */
  categoryId: string;
  label: string;
  color: string;
  categoryValue: number;
  column: Column;
  synthetic: boolean;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  value?: number;
}

/** The link datum shape fed into d3-sankey. `from`/`to` survive layout as plain
 *  strings even though d3 rewrites `source`/`target` into node references. */
interface LinkDatum {
  id: string;
  from: string;
  to: string;
  source: string;
  target: string;
  value: number;
  color: string;
  width?: number;
}

export function layoutSankey(input: SankeyInput): SankeyLayout {
  const { width, height } = input;

  // A zero-value category would render as an invisible sliver and an
  // unreachable label, so drop it rather than draw it.
  const incomingRaw = input.incoming.filter((c) => c.value > 0);
  const outgoingRaw = input.outgoing.filter((c) => c.value > 0);

  const totalIn = incomingRaw.reduce((s, c) => s + c.value, 0);
  const totalOut = outgoingRaw.reduce((s, c) => s + c.value, 0);

  if (incomingRaw.length === 0 && outgoingRaw.length === 0) {
    return { nodes: [], links: [], totalIn: 0, totalOut: 0, contentHeight: height };
  }

  const incoming = [...incomingRaw];
  const outgoing = [...outgoingRaw];
  if (totalIn > totalOut) {
    outgoing.push({ id: RETAINED_ID, label: RETAINED_LABEL, value: totalIn - totalOut, color: MUTED_COLOR });
  } else if (totalOut > totalIn) {
    incoming.push({ id: DRAWN_ID, label: DRAWN_LABEL, value: totalOut - totalIn, color: MUTED_COLOR });
  }

  const isSynthetic = (id: string) => id === RETAINED_ID || id === DRAWN_ID;

  const nodeData: NodeDatum[] = [
    ...incoming.map((c) => ({
      id: graphNodeId('in', c.id),
      categoryId: c.id,
      label: c.label,
      color: c.color,
      categoryValue: c.value,
      column: 'in' as const,
      synthetic: isSynthetic(c.id)
    })),
    {
      id: TOTAL_ID,
      categoryId: TOTAL_ID,
      label: 'Total',
      color: 'var(--color-outline)',
      categoryValue: 0,
      column: 'total' as const,
      synthetic: false
    },
    ...outgoing.map((c) => ({
      id: graphNodeId('out', c.id),
      categoryId: c.id,
      label: c.label,
      color: c.color,
      categoryValue: c.value,
      column: 'out' as const,
      synthetic: isSynthetic(c.id)
    }))
  ];

  const linkData: LinkDatum[] = [
    ...incoming.map((c) => ({
      id: `in:${c.id}`,
      from: graphNodeId('in', c.id),
      to: TOTAL_ID,
      source: graphNodeId('in', c.id),
      target: TOTAL_ID,
      value: c.value,
      color: c.color
    })),
    ...outgoing.map((c) => ({
      id: `out:${c.id}`,
      from: TOTAL_ID,
      to: graphNodeId('out', c.id),
      source: TOTAL_ID,
      target: graphNodeId('out', c.id),
      value: c.value,
      color: c.color
    }))
  ];

  const extentBottom = Math.max(height - LABEL_INSET_BOTTOM, LABEL_INSET_TOP + 1);

  const generator = sankey<{ nodes: NodeDatum[]; links: LinkDatum[] }, NodeDatum, LinkDatum>()
    .nodeId((d) => d.id)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .extent([
      [0, LABEL_INSET_TOP],
      [width, extentBottom]
    ]);

  const graph = generator({ nodes: nodeData, links: linkData });
  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();

  const nodes: SankeyNode[] = graph.nodes.map((n) => {
    const y0 = n.y0 ?? 0;
    const y1 = n.y1 ?? 0;
    const centerY = (y0 + y1) / 2;
    return {
      id: n.id,
      categoryId: n.categoryId,
      label: n.label,
      value: n.column === 'total' ? (n.value ?? 0) : n.categoryValue,
      color: n.color,
      x: n.x0 ?? 0,
      y: y0,
      width: (n.x1 ?? 0) - (n.x0 ?? 0),
      height: y1 - y0,
      centerY,
      labelY: centerY,
      column: n.column,
      synthetic: n.synthetic
    };
  });

  const links: SankeyLink[] = graph.links.map((l) => ({
    id: l.id,
    from: l.from,
    to: l.to,
    path: linkPath(l) ?? '',
    width: l.width ?? 0,
    color: l.color
  }));

  resolveLabelCollisions(nodes, 'in', height);
  resolveLabelCollisions(nodes, 'out', height);

  // Everything above keeps MIN_LABEL_GAP between anchors as a hard constraint,
  // so when there are more labels than the height can seat at that spacing the
  // run has to end up below the canvas. Reporting the extent it actually needs
  // lets the caller draw a taller viewBox rather than clip the overflow --
  // which is what used to happen, silently, on the busiest view.
  const lowestLabel = nodes.reduce((max, n) => Math.max(max, n.labelY), 0);
  const contentHeight = Math.max(height, lowestLabel + LABEL_INSET_BOTTOM);

  return { nodes, links, totalIn, totalOut, contentHeight };
}

/**
 * Seat one column's labels so no two anchors are closer than MIN_LABEL_GAP.
 *
 * The downward pass alone is not enough. When one category dwarfs the rest --
 * the usual shape once every season is in view -- the small nodes all bunch up
 * near the bottom, and each one gets pushed below the last until the run
 * leaves the canvas entirely. So a second pass walks back up from the bottom,
 * pulling the overhang into the space the sparse top of the column was never
 * using. Labels only stay off-canvas when the column genuinely cannot seat
 * them all, which `contentHeight` then absorbs.
 */
function resolveLabelCollisions(nodes: SankeyNode[], column: 'in' | 'out', height: number): void {
  const columnNodes = nodes.filter((n) => n.column === column).sort((a, b) => a.centerY - b.centerY);
  if (columnNodes.length === 0) return;

  let prevLabelY = -Infinity;
  for (const n of columnNodes) {
    n.labelY = Math.max(n.centerY, prevLabelY + MIN_LABEL_GAP);
    prevLabelY = n.labelY;
  }

  const bottomLimit = height - LABEL_INSET_BOTTOM;

  // The gap is a hard constraint, not a preference: squeezing labels closer
  // together to fit makes them overlap, which is worse than a taller diagram.
  // So when the column cannot seat them all at full spacing, leave the
  // downward pass alone and let `contentHeight` grow the canvas instead.
  const required = (columnNodes.length - 1) * MIN_LABEL_GAP;
  if (required > bottomLimit - LABEL_INSET_TOP) return;

  let nextLabelY = Infinity;
  for (let i = columnNodes.length - 1; i >= 0; i--) {
    const n = columnNodes[i];
    const highestAllowed = Math.min(nextLabelY - MIN_LABEL_GAP, bottomLimit);
    n.labelY = Math.max(LABEL_INSET_TOP, Math.min(n.labelY, highestAllowed));
    nextLabelY = n.labelY;
  }
}
