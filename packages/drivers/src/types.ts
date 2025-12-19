import { Rect } from '@adf/browser/types';

export interface PerceptualSnapshot {
  text: string;
  cursorBox?: Rect | null;
}

export type UserActionType = 'KEY_PRESS' | 'CLICK' | 'TYPE';

export interface UserAction {
  type: UserActionType;
  key?: string;
  text?: string;
  targetId?: string;
  x?: number;
  y?: number;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  snapshot: PerceptualSnapshot;
}
