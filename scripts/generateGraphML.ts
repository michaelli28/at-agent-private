/**
 * This script was used to generate GraphML from the virtual screen reader's
 * accessibility tree traversal data.
 *
 * The virtual-screen-reader has been archived and replaced with Guidepup.
 * Guidepup uses real VoiceOver which doesn't expose the accessibility tree
 * in the same programmatic way.
 *
 * For accessibility tree analysis, consider using:
 * - Playwright's page.accessibility.snapshot() API
 * - Chrome DevTools Protocol accessibility APIs
 */

console.log('Note: generateGraphML.ts requires the archived virtual-screen-reader.');
console.log('This functionality is not available with Guidepup.');
console.log('');
console.log('Guidepup uses real VoiceOver which provides spoken output,');
console.log('not raw accessibility tree data.');
console.log('');
console.log('For accessibility tree analysis, consider:');
console.log('- Playwright: page.accessibility.snapshot()');
console.log('- Chrome DevTools Protocol: Accessibility.getFullAXTree');
