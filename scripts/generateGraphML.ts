import * as fs from 'fs';
import * as path from 'path';
import { BrowserClient } from '@adf/browser/playwrightClient'; // Import BrowserClient

// Types for the serialized tree data from the browser
interface SerializedNode {
    id: string;
    role: string;
    name: string;
    content: string;
    visited: boolean;
    visitCount: number;
    depth: number;
    parentId: string | null;
    isCurrent: boolean;
    order: number;
}

interface NavigationEdge {
    fromId: string;
    toId: string;
    action: string;
    timestamp: number;
}

interface SerializedTree {
    nodes: SerializedNode[];
    edges: NavigationEdge[];
    stats: { totalNodes: number; visitedNodes: number; maxVisitCount: number };
    currentId: string | null;
}

async function main() {
    const url = process.argv[2];
    const outputFile = process.argv[3] || 'accessibility-graph.graphml';

    if (!url) {
        console.error('Usage: ts-node scripts/generateGraphML.ts <url> [output-file]');
        process.exit(1);
    }

    console.log(`Launching browser for ${url}...`);
    const browserClient = new BrowserClient(); // Use BrowserClient
    await browserClient.launch(true); // Launch in headless mode

    // Inject the screen reader script
    const injectedScriptPath = path.join(__dirname, '../drivers/dist/injected.js');
    if (!fs.existsSync(injectedScriptPath)) {
        console.error(`Error: Injected script not found at ${injectedScriptPath}`);
        console.error('Please run "npm run build:injected" in the drivers package first.');
        await browserClient.close(); // Close using BrowserClient
        process.exit(1);
    }
    const injectedScript = fs.readFileSync(injectedScriptPath, 'utf8');

    try {
        await browserClient.goto(url, 'networkidle'); // Navigate and wait for network idle

        // Inject the screen reader
        await browserClient.injectScript(injectedScript); // Inject using BrowserClient

        console.log('Screen reader injected. Waiting for stabilization...');
        await browserClient.waitForTimeout(2000); // Wait for any final rendering/hydration

        console.log('Starting full scan (Shift+A)...');

        // Trigger the "Instant Traverse" (Shift+A) logic via console or event
        // We'll use the keyboard handler logic directly if exposed, or dispatch the key event

        // Listen for the tree data update
        const treeDataPromise = new Promise<SerializedTree>((resolve) => {
            const timeout = setTimeout(() => {
                console.log("Timeout waiting for tree data.");
                // resolve empty/partial data or handle error?
                // For now, let's keep it pending or fail, but the outer try/catch might handle it if we throw
                // But this is inside a promise.
            }, 60000);

            browserClient.onConsoleMessage((msg) => { // Listen to console messages
                if (msg.startsWith('[SR Tree] ')) {
                    clearTimeout(timeout);
                    const jsonStr = msg.substring(10);
                    try {
                        const data = JSON.parse(jsonStr);
                        // We want the final tree after traversal
                        // The instant traverse logs the tree at the end
                        resolve(data);
                    } catch (e) {
                        // ignore parse errors for partial logs
                    }
                }
            });
        });

        // Trigger Shift+A
        await browserClient.pressKey('Shift+A'); // Press key using BrowserClient

        console.log('Waiting for scan to complete...');

        // No need for page.waitForFunction, treeDataPromise handles waiting for the data
        const treeData = await treeDataPromise;
        console.log(`Scan complete. Found ${treeData.nodes.length} nodes and ${treeData.edges.length} edges.`);

        // Convert to GraphML
        const graphML = convertToGraphML(treeData);

        fs.writeFileSync(outputFile, graphML);
        console.log(`GraphML saved to ${outputFile}`);

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        await browserClient.close(); // Close using BrowserClient
    }
}

function convertToGraphML(data: SerializedTree): string {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<graphml xmlns="http://graphml.graphdrawing.org/xmlns"\n';
    xml += '    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
    xml += '    xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns\n';
    xml += '     http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">\n';

    // Define keys for node attributes
    xml += '  <key id="d0" for="node" attr.name="role" attr.type="string"/>\n';
    xml += '  <key id="d1" for="node" attr.name="name" attr.type="string"/>\n';
    xml += '  <key id="d2" for="node" attr.name="content" attr.type="string"/>\n';
    xml += '  <key id="d4" for="node" attr.name="label" attr.type="string"/>\n';

    // Define keys for edge attributes
    xml += '  <key id="d3" for="edge" attr.name="action" attr.type="string"/>\n';

    xml += '  <graph id="G" edgedefault="directed">\n';

    // Nodes
    for (const node of data.nodes) {
        const label = node.name
            ? `${node.role}: ${node.name}`
            : (node.content ? `${node.role}: "${node.content}"` : node.role);

        xml += `    <node id="${escapeXml(node.id)}">\n`;
        xml += `      <data key="d0">${escapeXml(node.role)}</data>\n`;
        xml += `      <data key="d1">${escapeXml(node.name)}</data>\n`;
        xml += `      <data key="d2">${escapeXml(node.content)}</data>\n`;
        xml += `      <data key="d4">${escapeXml(label)}</data>\n`;
        xml += `    </node>\n`;
    }

    // Edges
    for (const edge of data.edges) {
        xml += `    <edge source="${escapeXml(edge.fromId)}" target="${escapeXml(edge.toId)}">\n`;
        xml += `      <data key="d3">${escapeXml(edge.action)}</data>\n`;
        xml += `    </edge>\n`;
    }

    xml += '  </graph>\n';
    xml += '</graphml>';

    return xml;
}

function escapeXml(unsafe: string | null | undefined): string {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'\\"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

main();
