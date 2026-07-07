export type Member = { id: string; name: string; realName: string };

function matchIn(raw: string, pool: Member[]): string | null {
  const q = raw.toLowerCase().trim();
  for (const m of pool) {
    const names = [m.name, m.realName, m.realName.split(' ')[0]].map(n => n.toLowerCase());
    if (names.includes(q)) return m.id;
  }
  return null;
}

export function resolveOwner(raw: string, threadParticipants: Member[], allMembers: Member[]): string {
  const mention = raw.match(/^<@([UW][A-Z0-9]+)(\|[^>]*)?>$/);
  if (mention) return mention[1];
  return matchIn(raw, threadParticipants) ?? matchIn(raw, allMembers) ?? raw;
}
