import { UserAction, ActionResult, PerceptualSnapshot } from './types';

export interface IAccessibilityDriver {
  name: string;

  /**
   * Enables the driver (e.g., starts the screen reader simulation).
   */
  enable(): Promise<void>;

  /**
   * Disables the driver.
   */
  disable(): Promise<void>;

  /**
   * Performs a user action (e.g., pressing a key) and returns the result.
   */
  performAction(action: UserAction): Promise<ActionResult>;

  /**
   * Gets the current perceptual output (what the user "sees" or "hears").
   */
  getPerceptualOutput(): Promise<PerceptualSnapshot>;
}
