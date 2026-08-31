import { describe, it, expect } from 'vitest';
import { layoutSankey, MIN_LABEL_GAP, type SankeyInput } from './sankey';

// Balanced on purpose: totalIn === totalOut === 8000, so the "neither
// synthetic node" case can reuse this fixture, and the proportionality
// checks don't have to account for a Retained/Drawn node being injected.
const base: SankeyInput = {
  incoming: [
    { id: 'grants', label: 'Grants', value: 6000, color: 'var(--color-flow-1)' },
    { id: 'fundraising', label: 'Fundraising', value: 2000, color: 'var(--color-flow-5)' }
  ],
  outgoing: [
    { id: 'robot_parts', label: 'Robot & parts', value: 5000, color: 'var(--color-flow-6)' },
    { id: 'tools_shop', label: 'Tools & shop', value: 3000, color: 'var(--color-flow-7)' }
  ],
  width: 800,
  height: 400
};

const SECOND_LINE_DY = 14;

describe('layoutSankey', () => {
  it('emits a node per category plus the centre total', () => {
    const { nodes } = layoutSankey(base);
    expect(nodes.filter((n) => n.column === 'in')).toHaveLength(2);
    expect(nodes.filter((n) => n.column === 'out')).toHaveLength(2);
    expect(nodes.filter((n) => n.column === 'total')).toHaveLength(1);
  });

  it('sizes node height in proportion to value', () => {
    const { nodes } = layoutSankey(base);
    const grants = nodes.find((n) => n.categoryId === 'grants')!;
    const fundraising = nodes.find((n) => n.categoryId === 'fundraising')!;
    expect(grants.height / fundraising.height).toBeCloseTo(3, 5);
  });

  it('keeps every node inside the canvas', () => {
    const { nodes } = layoutSankey(base);
    for (const n of nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y + n.height).toBeLessThanOrEqual(base.height + 0.001);
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(base.width + 0.001);
    }
  });

  it('emits one link per category, each carrying an svg path meant to be stroked', () => {
    const { links } = layoutSankey(base);
    expect(links).toHaveLength(4);
    for (const l of links) {
      expect(l.path.startsWith('M')).toBe(true);
      expect(l.path).toContain('C');
      expect(l.width).toBeGreaterThan(0);
    }
  });

  it('omits zero-value categories rather than drawing them flat', () => {
    const { nodes, links } = layoutSankey({
      ...base,
      incoming: [...base.incoming, { id: 'empty', label: 'Empty', value: 0, color: 'x' }]
    });
    expect(nodes.find((n) => n.categoryId === 'empty')).toBeUndefined();
    expect(links.find((l) => l.from === 'in:empty')).toBeUndefined();
  });

  it('lays out a single category on one side', () => {
    const { nodes } = layoutSankey({
      ...base,
      incoming: [{ id: 'only', label: 'Only', value: 100, color: 'x' }]
    });
    expect(nodes.find((n) => n.categoryId === 'only')).toBeDefined();
  });

  // Real-world case: `uncategorized` is a key in BOTH INCOME_CATEGORY_META and
  // EXPENSE_CATEGORY_META (src/lib/finance/categories.ts). A season can have
  // unmatched HCB income and unmatched HCB spend at the same time, so the same
  // category id shows up on both the incoming and outgoing side. If node
  // identity is just the raw category id, that produces two nodes sharing one
  // id, which makes the link list contain both `uncategorized -> Total` and
  // `Total -> uncategorized` -- a cycle that d3-sankey rejects with "circular
  // link". Do not simplify this fixture down to distinct ids per side; the
  // whole point is the collision.
  it('lays out a category id that appears on both the incoming and outgoing side without throwing, as two distinct nodes', () => {
    const input: SankeyInput = {
      incoming: [
        { id: 'grants', label: 'Grants', value: 1000, color: 'var(--color-flow-1)' },
        { id: 'uncategorized', label: 'Uncategorized', value: 500, color: 'var(--color-flow-muted)' }
      ],
      outgoing: [
        { id: 'robot_parts', label: 'Robot & parts', value: 1200, color: 'var(--color-flow-6)' },
        { id: 'uncategorized', label: 'Uncategorized', value: 300, color: 'var(--color-flow-muted)' }
      ],
      width: 800,
      height: 400
    };

    let result: ReturnType<typeof layoutSankey>;
    expect(() => {
      result = layoutSankey(input);
    }).not.toThrow();

    const uncategorizedNodes = result!.nodes.filter((n) => n.categoryId === 'uncategorized');
    expect(uncategorizedNodes).toHaveLength(2);

    const ids = new Set(result!.nodes.map((n) => n.id));
    expect(ids.size).toBe(result!.nodes.length);

    const incomingUncategorized = uncategorizedNodes.find((n) => n.column === 'in');
    const outgoingUncategorized = uncategorizedNodes.find((n) => n.column === 'out');
    expect(incomingUncategorized).toBeDefined();
    expect(outgoingUncategorized).toBeDefined();
    expect(incomingUncategorized!.id).not.toBe(outgoingUncategorized!.id);
    expect(incomingUncategorized!.value).toBe(500);
    expect(outgoingUncategorized!.value).toBe(300);
  });

  it('returns empty output for empty input without throwing', () => {
    const result = layoutSankey({ ...base, incoming: [], outgoing: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it('reports the two totals it was given', () => {
    const { totalIn, totalOut } = layoutSankey(base);
    expect(totalIn).toBe(8000);
    expect(totalOut).toBe(8000);
  });

  it('gives every node a centerY that is the true midpoint of its bar', () => {
    const { nodes } = layoutSankey(base);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(Math.abs(n.centerY - (n.y + n.height / 2))).toBeLessThan(0.0001);
    }
  });

  describe('balancing the diagram', () => {
    const surplus: SankeyInput = {
      incoming: [
        { id: 'grants', label: 'Grants', value: 9000, color: 'var(--color-flow-1)' },
        { id: 'fundraising', label: 'Fundraising', value: 3000, color: 'var(--color-flow-5)' }
      ],
      outgoing: [
        { id: 'robot_parts', label: 'Robot & parts', value: 1500, color: 'var(--color-flow-6)' },
        { id: 'tools_shop', label: 'Tools & shop', value: 500, color: 'var(--color-flow-7)' }
      ],
      width: 800,
      height: 400
    };

    const shortfall: SankeyInput = {
      incoming: [{ id: 'fundraising', label: 'Fundraising', value: 400, color: 'var(--color-flow-5)' }],
      outgoing: [
        { id: 'robot_parts', label: 'Robot & parts', value: 1000, color: 'var(--color-flow-6)' },
        { id: 'tools_shop', label: 'Tools & shop', value: 600, color: 'var(--color-flow-7)' }
      ],
      width: 800,
      height: 400
    };

    it('adds a Retained node on the outgoing side carrying exactly the surplus when income exceeds spending', () => {
      const { nodes } = layoutSankey(surplus);
      const retained = nodes.find((n) => n.label === 'Retained');
      expect(retained).toBeDefined();
      expect(retained!.column).toBe('out');
      expect(retained!.value).toBeCloseTo(12000 - 2000, 5);
      expect(retained!.color).toBe('var(--color-flow-muted)');
      expect(retained!.synthetic).toBe(true);
      expect(nodes.find((n) => n.label === 'Drawn from reserves')).toBeUndefined();
    });

    it('balances total inflow and total outflow once Retained is added', () => {
      const { nodes } = layoutSankey(surplus);
      const inSum = nodes.filter((n) => n.column === 'in').reduce((s, n) => s + n.value, 0);
      const outSum = nodes.filter((n) => n.column === 'out').reduce((s, n) => s + n.value, 0);
      expect(outSum).toBeCloseTo(inSum, 5);
    });

    it('adds a Drawn from reserves node on the incoming side carrying exactly the shortfall when spending exceeds income', () => {
      const { nodes } = layoutSankey(shortfall);
      const drawn = nodes.find((n) => n.label === 'Drawn from reserves');
      expect(drawn).toBeDefined();
      expect(drawn!.column).toBe('in');
      expect(drawn!.value).toBeCloseTo(1600 - 400, 5);
      expect(drawn!.color).toBe('var(--color-flow-muted)');
      expect(drawn!.synthetic).toBe(true);
      expect(nodes.find((n) => n.label === 'Retained')).toBeUndefined();
    });

    it('balances total inflow and total outflow once Drawn from reserves is added', () => {
      const { nodes } = layoutSankey(shortfall);
      const inSum = nodes.filter((n) => n.column === 'in').reduce((s, n) => s + n.value, 0);
      const outSum = nodes.filter((n) => n.column === 'out').reduce((s, n) => s + n.value, 0);
      expect(outSum).toBeCloseTo(inSum, 5);
    });

    it('adds neither synthetic node when income and spending are already equal', () => {
      const { nodes } = layoutSankey(base);
      expect(nodes.find((n) => n.label === 'Retained')).toBeUndefined();
      expect(nodes.find((n) => n.label === 'Drawn from reserves')).toBeUndefined();
    });

    it('reports the real totals it was given, unaffected by any synthetic node', () => {
      const { totalIn, totalOut } = layoutSankey(surplus);
      expect(totalIn).toBe(12000);
      expect(totalOut).toBe(2000);
    });
  });

  describe('label placement', () => {
    it('reserves enough room that even the lowest node\'s two-line label stays inside the canvas', () => {
      const { nodes } = layoutSankey(base);
      for (const n of nodes) {
        expect(n.labelY + SECOND_LINE_DY).toBeLessThanOrEqual(base.height);
      }
    });

    it('leaves an uncrowded label exactly where its node is centred', () => {
      const { nodes } = layoutSankey(base);
      for (const n of nodes) {
        expect(n.labelY).toBeCloseTo(n.centerY, 5);
      }
    });

    /**
     * The real "all seasons" shape: one category dominates each side and the
     * rest are small, so every small node sits near the bottom and each one
     * gets pushed down past the last. A single downward pass never checks the
     * canvas edge, so the run walks straight off the bottom of the SVG.
     */
    it('keeps labels on the canvas when one category dwarfs the rest', () => {
      const skewed = (prefix: string) => [
        { id: `${prefix}0`, label: 'Dominant', value: 50000, color: 'c' },
        { id: `${prefix}1`, label: 'Small one', value: 265, color: 'c' },
        { id: `${prefix}2`, label: 'Small two', value: 400, color: 'c' },
        { id: `${prefix}3`, label: 'Small three', value: 1177, color: 'c' },
        { id: `${prefix}4`, label: 'Small four', value: 1216, color: 'c' }
      ];
      const input = {
        incoming: skewed('in'),
        outgoing: skewed('out'),
        width: 600,
        height: 420
      };
      const { nodes, contentHeight } = layoutSankey(input);

      // The canvas the component actually draws has to contain every label,
      // second line included.
      for (const n of nodes) {
        expect(n.labelY + SECOND_LINE_DY).toBeLessThanOrEqual(contentHeight);
      }
    });

    it('does not grow the canvas when the labels already fit', () => {
      const { contentHeight } = layoutSankey(base);
      expect(contentHeight).toBe(base.height);
    });

    it('pushes down colliding same-column labels so adjacent anchors are at least the minimum gap apart', () => {
      const manyOut = Array.from({ length: 20 }, (_, i) => ({
        id: `cat${i}`,
        label: `Category ${i}`,
        value: 10,
        color: 'var(--color-flow-6)'
      }));
      const { nodes } = layoutSankey({
        incoming: [{ id: 'grants', label: 'Grants', value: 200, color: 'var(--color-flow-1)' }],
        outgoing: manyOut,
        width: 800,
        height: 400
      });

      const outNodes = nodes.filter((n) => n.column === 'out').sort((a, b) => a.centerY - b.centerY);
      expect(outNodes.length).toBeGreaterThan(1);
      for (let i = 1; i < outNodes.length; i++) {
        expect(outNodes[i].labelY - outNodes[i - 1].labelY).toBeGreaterThanOrEqual(MIN_LABEL_GAP - 0.001);
      }
      // Crowded on purpose: at least one label actually had to move off its node's centre.
      expect(outNodes.some((n) => Math.abs(n.labelY - n.centerY) > 0.001)).toBe(true);
    });
  });
});
