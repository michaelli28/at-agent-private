// WebSocket Protocol Types for Agent <-> Sandbox Communication

// Commands sent from Main Server to Sandbox
export type SandboxCommand =
  | { type: 'navigate'; url: string }
  | { type: 'voiceover_next' }
  | { type: 'voiceover_previous' }
  | { type: 'voiceover_activate' }
  | { type: 'voiceover_next_heading' }
  | { type: 'voiceover_previous_heading' }
  | { type: 'voiceover_next_link' }
  | { type: 'voiceover_next_form_field' }
  | { type: 'voiceover_type'; text: string }
  | { type: 'voiceover_press_key'; key: string }
  | { type: 'go_back' }
  | { type: 'get_state' }
  | { type: 'shutdown' };

// Responses sent from Sandbox to Main Server
export type SandboxResponse =
  | { type: 'ready' }
  | { type: 'state'; spokenText: string; url: string; pageTitle: string }
  | { type: 'action_complete'; success: boolean; spokenText: string; url: string; pageTitle: string }
  | { type: 'error'; message: string }
  | { type: 'shutdown_ack' };

// Message wrapper with request ID for correlation
export interface SandboxMessage<T = SandboxCommand | SandboxResponse> {
  id: string;
  payload: T;
}

// Snapshot returned to the agent (similar to old PerceptualSnapshot)
export interface SandboxSnapshot {
  text: string;      // What VoiceOver announced
  pageUrl: string;
  pageTitle: string;
}

// Result of an action
export interface SandboxActionResult {
  success: boolean;
  snapshot: SandboxSnapshot;
  message?: string;
}
