import { IAccessibilityDriver } from './IAccessibilityDriver';
import { UserAction, ActionResult, PerceptualSnapshot } from './types';
import { BrowserClient } from '@adf/browser/playwrightClient';

export class MagnifierDriver implements IAccessibilityDriver {
  name = "Magnifier";
  private enabled = false;
  private zoomLevel = 2.0;

  constructor(private client: BrowserClient) { }

  async enable(): Promise<void> {
    this.enabled = true;
    // Simulate magnification via CSS transform on the body
    // In a real app, we might use CDP Emulation.setDeviceMetricsOverride or similar
    await this.client['page']?.evaluate((zoom) => {
      document.body.style.transform = `scale(${zoom})`;
      document.body.style.transformOrigin = '0 0';
      document.body.style.width = `${100 / zoom}%`;
    }, this.zoomLevel);
    console.log(`Magnifier Enabled (Zoom: ${this.zoomLevel}x)`);
  }

  async disable(): Promise<void> {
    this.enabled = false;
    await this.client['page']?.evaluate(() => {
      document.body.style.transform = '';
      document.body.style.transformOrigin = '';
      document.body.style.width = '';
    });
    console.log("Magnifier Disabled");
  }

  async performAction(action: UserAction): Promise<ActionResult> {
    if (!this.enabled) return { success: false, message: "Driver disabled", snapshot: await this.getPerceptualOutput() };

    // Magnifier users mostly use mouse or keyboard.
    // We pass actions through to the browser.
    if (action.type === 'KEY_PRESS' && action.key) {
      await this.client.pressKey(action.key);
    } else if (action.type === 'CLICK' && action.x !== undefined && action.y !== undefined) {
      await this.client.click(action.x, action.y);
    }

    return { success: true, snapshot: await this.getPerceptualOutput() };
  }

  async getPerceptualOutput(): Promise<PerceptualSnapshot> {
    // For a magnifier, the "perceptual output" is the visible viewport.
    // We need to find where the focus is to know what the user is "seeing".

    // Hack to access private page object or use a public method if we added one
    // Assuming client.page is accessible or we add a method to get focus
    const focusBox = await this.client['page']?.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    if (focusBox) {
      return {
        text: `Visual Viewport centered on focused element at (${focusBox.x}, ${focusBox.y})`,
        cursorBox: focusBox
      };
    }

    return {
      text: "Visual Viewport at top left (No specific focus)",
      cursorBox: { x: 0, y: 0, width: 1280 / this.zoomLevel, height: 720 / this.zoomLevel }
    };
  }
}
