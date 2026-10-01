/** Identificador único (UUID v4) — disponível no Node e nos navegadores modernos. */
export const novoId = () => globalThis.crypto.randomUUID()
