<script lang="ts">
  import { layoutSankey, type SankeyCategory } from '$lib/finance/sankey';

  interface Props {
    incoming: SankeyCategory[];
    outgoing: SankeyCategory[];
    seasonLabel: string;
  }

  let { incoming, outgoing, seasonLabel }: Props = $props();

  const WIDTH = 900;
  /** The height asked for. The drawn canvas may be taller -- see `contentHeight`. */
  const HEIGHT = 420;
  /** Room for the labels that sit outside the node bars. */
  const PAD_X = 150;
  /** Vertical offset of a label's second (amount) tspan line, mirrored below. */
  const SECOND_LINE_DY = 14;

  const layout = $derived(
    layoutSankey({ incoming, outgoing, width: WIDTH - PAD_X * 2, height: HEIGHT })
  );

  const money = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // Percentages are taken against the larger of the two totals — the same
  // denominator on both sides once a Retained/Drawn-from-reserves node has
  // brought them into balance — so a column's shares (real categories plus
  // the synthetic node, if any) always add up to 100%.
  const grandTotal = $derived(Math.max(layout.totalIn, layout.totalOut));
  const pct = (value: number) => (grandTotal > 0 ? `${Math.round((value / grandTotal) * 100)}%` : '0%');

  const isEmpty = $derived(layout.nodes.length === 0);
</script>

{#if isEmpty}
  <div class="card-elevated p-10 text-center" style="color: var(--color-on-surface-variant)">
    <p class="type-title-sm">No money recorded for {seasonLabel}</p>
    <p class="type-body-sm mt-1">Log a deposit or an expense and the flow will appear here.</p>
  </div>
{:else}
  <!-- Below sm the diagram is unreadable, so the breakdown below the chart
       serves as both the mobile view and the accessible text equivalent. -->
  <div class="card-elevated hidden p-4 sm:block">
    <svg
      viewBox={`0 0 ${WIDTH} ${layout.contentHeight}`}
      class="h-auto w-full"
      role="img"
      aria-labelledby="sankey-title sankey-desc"
    >
      <title id="sankey-title">Money in and out for {seasonLabel}</title>
      <desc id="sankey-desc">
        {money(layout.totalIn)} in from {incoming.length} sources,
        {money(layout.totalOut)} out across {outgoing.length} categories.
        The same figures are listed in the breakdown below this chart.
      </desc>

      <g transform={`translate(${PAD_X}, 0)`} aria-hidden="true">
        {#each layout.links as link (link.id)}
          <path d={link.path} fill="none" stroke={link.color} stroke-width={link.width} opacity="0.35" />
        {/each}

        {#each layout.nodes as node (node.id)}
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            fill={node.color}
            rx="2"
            stroke-dasharray={node.synthetic ? '3 2' : undefined}
            stroke={node.synthetic ? 'var(--color-on-surface-variant)' : undefined}
            stroke-width={node.synthetic ? 1 : undefined}
          />
        {/each}
      </g>

      <g aria-hidden="true" style="font-size: 12px">
        {#each layout.nodes.filter((n) => n.column === 'in') as node (node.id)}
          {#if Math.abs(node.labelY - node.centerY) > 0.5}
            <line
              x1={PAD_X - 2}
              y1={node.centerY}
              x2={PAD_X - 10}
              y2={node.labelY}
              stroke="var(--color-outline-variant)"
              stroke-width="1"
            />
          {/if}
          <text
            x={PAD_X - 10}
            y={node.labelY}
            text-anchor="end"
            dominant-baseline="middle"
            fill="var(--color-on-surface)"
          >
            <tspan font-weight="600" font-style={node.synthetic ? 'italic' : undefined}>{node.label}</tspan>
            <tspan x={PAD_X - 10} dy={SECOND_LINE_DY} fill="var(--color-on-surface-variant)">
              {money(node.value)} ({pct(node.value)})
            </tspan>
          </text>
        {/each}

        {#each layout.nodes.filter((n) => n.column === 'out') as node (node.id)}
          {#if Math.abs(node.labelY - node.centerY) > 0.5}
            <line
              x1={WIDTH - PAD_X + 2}
              y1={node.centerY}
              x2={WIDTH - PAD_X + 10}
              y2={node.labelY}
              stroke="var(--color-outline-variant)"
              stroke-width="1"
            />
          {/if}
          <text x={WIDTH - PAD_X + 10} y={node.labelY} dominant-baseline="middle" fill="var(--color-on-surface)">
            <tspan font-weight="600" font-style={node.synthetic ? 'italic' : undefined}>{node.label}</tspan>
            <tspan x={WIDTH - PAD_X + 10} dy={SECOND_LINE_DY} fill="var(--color-on-surface-variant)">
              {money(node.value)} ({pct(node.value)})
            </tspan>
          </text>
        {/each}
      </g>
    </svg>
  </div>
{/if}
