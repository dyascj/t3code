import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

// One-shot entrances play once for an item that arrived moments ago, never
// for history or a row the virtualizer remounts.

const ENTRANCE_WINDOW_MS = 4000;
export const PROMPT_RISE_MS = 560;
export const PLAN_STEPS_MS = 3200;
export const CONSTELLATION_MS = 3100;
const playedEntrances = new Set<string>();

export function useOneShotEntrance(id: string, createdAt: string | undefined, durationMs: number) {
  const [fresh] = useState(() => {
    if (!createdAt || playedEntrances.has(id)) return false;
    return Math.abs(Date.now() - Date.parse(createdAt)) < ENTRANCE_WINDOW_MS;
  });
  const [done, setDone] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that ends the entrance and marks it played so remounts skip it
  useEffect(() => {
    if (!fresh) return;
    playedEntrances.add(id);
    const timer = setTimeout(() => setDone(true), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, fresh, id]);
  return fresh && !done;
}

interface ConstellationPoint {
  x: number;
  y: number;
  from: { x: number; y: number };
  delay: number;
  draw: number;
  child: boolean;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Hub at the bottom center, 3-6 nodes fanned above it, every other node with a child. */
function buildConstellation(width: number, height: number) {
  const pad = 8;
  const maxX = Math.max(pad, width - pad);
  const maxY = Math.max(pad, height - pad);
  const hub = { x: width / 2, y: maxY };
  const count = clampNumber(Math.round(width / 90), 3, 6);
  const top = Math.min(maxY, Math.max(pad, height * 0.35));
  const bottom = Math.max(top, Math.min(maxY - 10, height * 0.7));
  const nodes: ConstellationPoint[] = Array.from({ length: count }, (_, index) => ({
    x: clampNumber(((index + 0.2 + Math.random() * 0.6) / count) * width, pad, maxX),
    y: top + Math.random() * (bottom - top),
    from: hub,
    delay: 0,
    draw: 320,
    child: false,
  }));
  nodes.sort((a, b) => Math.abs(a.x - hub.x) - Math.abs(b.x - hub.x));
  nodes.forEach((node, index) => {
    node.delay = 280 + index * 80;
  });
  const children = nodes
    .filter((_, index) => index % 2 === 1)
    .map((node) => ({
      x: clampNumber(node.x + (node.x < hub.x ? -1 : 1) * (22 + Math.random() * 18), pad, maxX),
      y: clampNumber(node.y + (Math.random() - 0.5) * 12, top, maxY),
      from: { x: node.x, y: node.y },
      delay: node.delay + node.draw + 60,
      draw: 220,
      child: true,
    }));
  return { hub, nodes: [...nodes, ...children] };
}

/** The orchestrator flourish: a hub sends edges out to its agents, then the net lifts away. */
export function OrchestratorConstellation() {
  const ref = useRef<HTMLSpanElement>(null);
  const [network, setNetwork] = useState<{
    width: number;
    height: number;
    graph: ReturnType<typeof buildConstellation>;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the flourish's box before paint to lay the network out in it
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box) {
      setNetwork({
        width: box.width,
        height: box.height,
        graph: buildConstellation(box.width, box.height),
      });
    }
  }, []);
  return (
    <span aria-hidden ref={ref} className="orchestrator-constellation">
      {network ? (
        <span className="orchestrator-network">
          <svg
            className="orchestrator-edges"
            width={network.width}
            height={network.height}
            viewBox={`0 0 ${network.width} ${network.height}`}
          >
            {network.graph.nodes.map((node, index) => {
              const style = {
                "--length": Math.hypot(node.x - node.from.x, node.y - node.from.y),
                "--delay": `${node.delay}ms`,
                "--draw": `${node.draw}ms`,
              } as CSSProperties;
              return (
                // oxlint-disable-next-line react/no-array-index-key -- a fixed set built once, so a node's index is its identity
                <g key={index}>
                  <line
                    className="orchestrator-edge"
                    x1={node.from.x}
                    y1={node.from.y}
                    x2={node.x}
                    y2={node.y}
                    style={style}
                  />
                  <line
                    className="orchestrator-pulse"
                    x1={node.from.x}
                    y1={node.from.y}
                    x2={node.x}
                    y2={node.y}
                    style={style}
                  />
                </g>
              );
            })}
          </svg>
          <span
            className="orchestrator-hub"
            style={{ left: network.graph.hub.x, top: network.graph.hub.y }}
          />
          {network.graph.nodes.map((node, index) => (
            <span
              // oxlint-disable-next-line react/no-array-index-key -- a fixed set built once, so a node's index is its identity
              key={index}
              className="orchestrator-node"
              data-child={node.child ? "true" : undefined}
              style={
                {
                  left: node.x,
                  top: node.y,
                  "--delay": `${node.delay + node.draw - 40}ms`,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
    </span>
  );
}
