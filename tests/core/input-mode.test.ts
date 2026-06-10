import { describe, expect, it } from "vitest";
import { isSparseTree, resolveInputMode } from "../../src/core/agent-loop.js";
import type { ViewTreeNode } from "../../src/core/types.js";

function node(id: number, children?: ViewTreeNode[]): ViewTreeNode {
  return {
    id,
    type: "Button",
    label: `Node ${id}`,
    frame: { x: 0, y: 0, w: 10, h: 10 },
    ...(children ? { children } : {}),
  };
}

describe("isSparseTree", () => {
  it("treats null as not sparse", () => {
    expect(isSparseTree(null)).toBe(false);
  });

  it("treats a tree with <= 10 leaves as sparse", () => {
    expect(isSparseTree([node(0), node(1)])).toBe(true);
  });

  it("treats a tree with > 10 leaves as not sparse", () => {
    const nodes = Array.from({ length: 11 }, (_, i) => node(i));
    expect(isSparseTree(nodes)).toBe(false);
  });

  it("counts leaf nodes recursively", () => {
    const tree = [node(0, Array.from({ length: 11 }, (_, i) => node(i + 1)))];
    expect(isSparseTree(tree)).toBe(false);
  });
});

describe("resolveInputMode", () => {
  const normalTree = Array.from({ length: 11 }, (_, i) => node(i));
  const sparseTree = [node(0), node(1)];

  it("forces screenshot when requested by agent loop", () => {
    expect(resolveInputMode(undefined, normalTree, true)).toBe("screenshot");
  });

  it("honors explicit screenshot config", () => {
    expect(resolveInputMode("screenshot", normalTree, false)).toBe("screenshot");
  });

  it("falls back to screenshot when tree is unavailable", () => {
    expect(resolveInputMode(undefined, null, false)).toBe("screenshot");
  });

  it("uses hybrid for sparse trees in the current v0.1 behavior", () => {
    expect(resolveInputMode(undefined, sparseTree, false)).toBe("hybrid");
  });

  it("uses viewtree for non-sparse trees", () => {
    expect(resolveInputMode(undefined, normalTree, false)).toBe("viewtree");
  });

  it("keeps explicit viewtree mode subject to sparse tree fallback", () => {
    expect(resolveInputMode("viewtree", sparseTree, false)).toBe("hybrid");
  });
});
