import { IAccessibilityDriver } from './IAccessibilityDriver';
import { UserAction, ActionResult, PerceptualSnapshot } from './types';
import { BrowserClient } from '@adf/browser/playwrightClient';
import * as fs from 'fs';
import * as path from 'path';

export class ScreenReaderDriver implements IAccessibilityDriver {
  name = "ScreenReader";
  private enabled = false;
  private lastSpokenText: string = "";
  private lastCursorBox: any = null; // Injected driver handles highlighting, but we might want to track it

  constructor(private client: BrowserClient) { }

  async enable(): Promise<void> {
    this.enabled = true;
    console.log("Screen Reader Enabled (In-Browser)");

    // Inject the driver script
    const scriptPath = path.join(__dirname, '../dist/injected.js');
    if (fs.existsSync(scriptPath)) {
      const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
      await this.client.injectScript(scriptContent);
    } else {
      console.error("Injected driver script not found at:", scriptPath);
    }

    // Listen for spoken output
    this.client.onConsoleMessage((msg) => {
      if (msg.startsWith('[SR] ')) {
        this.lastSpokenText = msg.replace('[SR] ', '');
      }
    });
  }

  async disable(): Promise<void> {
    this.enabled = false;
    console.log("Screen Reader Disabled");
  }

  async performAction(action: UserAction): Promise<ActionResult> {
    if (!this.enabled) {
      return { success: false, message: "Driver not enabled", snapshot: await this.getPerceptualOutput() };
    }

    if (action.type === 'KEY_PRESS') {
      if (action.key) {
        // Just pass the key to the browser. The injected script handles the logic.
        await this.client.pressKey(action.key);

        // Wait a bit for the injected script to process and emit output
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      success: true,
      snapshot: await this.getPerceptualOutput()
    };
  }

  async getPerceptualOutput(): Promise<PerceptualSnapshot> {
    if (!this.enabled) {
      return { text: "Screen Reader Off", cursorBox: null };
    }

    // Return the last text we heard from the injected script
    return {
      text: this.lastSpokenText || "No output",
      cursorBox: null // Box is drawn by injected script, we don't track it here anymore
    };
  }
}
