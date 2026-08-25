/**
 * Controle de acesso principal do produto single-user (SECURITY.md §2):
 * mensagem de qualquer JID que não seja o dono é ignorada e logada,
 * nunca processada. Comparação normalizada porque a Evolution às vezes
 * anexa sufixo de dispositivo (`:12`) ao JID.
 */
export function normalizeJid(jid: string): string {
  return jid.replace(/:\d+(?=@)/, '');
}

export function isFromOwner(jid: string, ownerJid: string): boolean {
  return normalizeJid(jid) === normalizeJid(ownerJid);
}
