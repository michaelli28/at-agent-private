/**
 * Represents a node in the Accessibility Tree as returned by CDP.
 * Based on Protocol.Accessibility.AXNode
 */
export interface AXNode {
    nodeId: string;
    ignored: boolean;
    ignoredReasons?: { reason: string }[];
    role?: AXValue;
    name?: AXValue;
    description?: AXValue;
    value?: AXValue;
    properties?: AXProperty[];
    childIds?: string[];
    backendDOMNodeId?: number;
    frameId?: string;
}

export interface AXValue {
    type: AXValueType;
    value?: any;
    relatedNodes?: AXRelatedNode[];
    sources?: AXValueSource[];
}

export type AXValueType =
    | 'boolean'
    | 'tristate'
    | 'booleanOrUndefined'
    | 'idref'
    | 'idrefList'
    | 'integer'
    | 'node'
    | 'nodeList'
    | 'number'
    | 'string'
    | 'computedString'
    | 'token'
    | 'tokenList'
    | 'domRelation'
    | 'role'
    | 'internalRole'
    | 'valueUndefined';

export interface AXProperty {
    name: string;
    value: AXValue;
}

export interface AXRelatedNode {
    backendDOMNodeId: number;
    idref?: string;
    text?: string;
}

export interface AXValueSource {
    type: string;
    value?: AXValue;
    attribute?: string;
    attributeValue?: AXValue;
    superseded?: boolean;
    nativeSource?: string;
    nativeSourceValue?: AXValue;
    invalid?: boolean;
    invalidReason?: string;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
