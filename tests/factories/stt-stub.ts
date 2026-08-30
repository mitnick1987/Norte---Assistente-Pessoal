import { jsonResponse } from './fetch-stub.js';

/** Resposta de sucesso no formato compartilhado por Groq e OpenAI (endpoint OpenAI-compatible). */
export function sttTranscriptionResponse(text: string): Response {
  return jsonResponse(200, { text });
}

export function sttErrorResponse(status: number, message = 'erro simulado'): Response {
  return jsonResponse(status, { error: { message } });
}
