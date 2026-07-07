export const SYSTEM_PROMPT = `You extract decisions and commitments from Slack threads or meeting notes.
Return ONLY a JSON object: {"decisions":[{"what","rationale","decided_by"}],"commitments":[{"owner","task","deadline"}]}.
Rules:
- A decision is something the group settled on; include the stated rationale ("" if none) and who decided ("" if unclear).
- A commitment is a person agreeing to do a specific thing. "owner" is the name/handle as written.
- "deadline": "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" if stated or clearly implied, else null. Never invent one.
- If nothing was decided or committed, return {"decisions":[],"commitments":[]}. Do NOT force output.
- No prose, no markdown, JSON only.`;

export function userPrompt(threadText: string, todayIso = new Date().toISOString().slice(0, 10)): string {
  return `Today's date is ${todayIso}. Resolve relative or year-less dates (e.g. "Friday July 10", "by Wed") against it, never a past year.\nThread:\n"""\n${threadText}\n"""`;
}
