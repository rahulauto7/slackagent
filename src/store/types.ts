export type CommitmentStatus = 'open' | 'done' | 'slipped';

export interface Decision {
  id: number; channel_id: string; what: string; rationale: string;
  decided_by: string; source_permalink: string; created_at: string;
}

export interface Commitment {
  id: number; channel_id: string; owner_user_id: string; task: string;
  deadline: string | null; status: CommitmentStatus;
  source_permalink: string; nudge_scheduled_id: string | null; created_at: string;
}

export function isSlackUserId(owner: string): boolean {
  return /^[UW][A-Z0-9]{2,}$/.test(owner);
}
