const RUNTIME_TO_ASSET_DANCE_ID: Readonly<Record<string, string>> = {
  cat: "dance-001",
  cloud: "dance-002",
  fade: "dance-003",
  fight: "dance-004",
  indo: "dance-005",
  no: "dance-006",
};

const SAFE_DANCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function danceAssetId(danceId: string): string | null {
  if (!SAFE_DANCE_ID.test(danceId)) return null;
  return RUNTIME_TO_ASSET_DANCE_ID[danceId] ?? danceId;
}
