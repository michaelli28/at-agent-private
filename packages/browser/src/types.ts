export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AXNode {
  nodeId: string;
  backendDOMNodeId?: number;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  children?: AXNode[];
  properties?: Array<{ name: string; value: { value: unknown } }>;
}
