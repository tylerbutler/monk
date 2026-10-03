function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
}
async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export async function issueToken(): Promise<{ token: string; verifier: string }> {
  const token = randomToken();
  return { token, verifier: await hash(token) };
}
export async function verifyToken(token: string, verifier: string): Promise<boolean> {
  const digest = await hash(token);
  let difference = digest.length ^ verifier.length;
  for (let i = 0; i < digest.length; i++) difference |= digest.charCodeAt(i) ^ verifier.charCodeAt(i);
  return difference === 0;
}
export function issueCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b & 31]).join("");
}
