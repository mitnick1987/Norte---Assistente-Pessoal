import { vi } from 'vitest';

export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

/**
 * Stub de `fetch` global — substitui a Evolution real sem dependência
 * externa (nock exigiria interceptar por URL; como o client já isola toda
 * chamada em EvolutionClient, mockar o fetch global é equivalente e mais
 * simples). Nunca aponta para rede real durante o CI.
 */
export function stubFetch(responder: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const call = { url: url.toString(), init };
    calls.push(call);
    return responder(call);
  });
  vi.stubGlobal('fetch', stub);
  return { calls, stub };
}

export function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
