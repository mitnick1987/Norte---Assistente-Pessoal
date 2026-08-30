import { describe, expect, it } from 'vitest';
import { GOOGLE_CALENDAR_SCOPE, GoogleOAuthClient } from '../../src/modules/integrations/google-calendar/google-oauth-client.js';

function buildClient(): GoogleOAuthClient {
  return new GoogleOAuthClient({
    clientId: 'client-id-teste',
    clientSecret: 'client-secret-teste',
    redirectUri: 'http://localhost:3000/setup/google/callback',
  });
}

describe('GoogleOAuthClient — URL de consent (spec item 1, ADR-010)', () => {
  it('solicita exatamente o escopo calendar.events, nunca calendar completo', () => {
    const client = buildClient();

    const url = new URL(client.buildConsentUrl());

    expect(GOOGLE_CALENDAR_SCOPE).toBe('https://www.googleapis.com/auth/calendar.events');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPE);
  });

  it('força access_type=offline e prompt=consent — sem isso o Google só reemite refresh_token na primeira autorização', () => {
    const client = buildClient();

    const url = new URL(client.buildConsentUrl());

    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
  });
});
