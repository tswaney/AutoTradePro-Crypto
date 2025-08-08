import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Expo SDK-friendly Auth helpers for Azure AD B2C
 * - Uses expo-auth-session (Auth Code + PKCE)
 * - Works in Expo Go (no custom dev client needed)
 * - No `useProxy` options required (Expo chooses sane defaults in dev)
 */
WebBrowser.maybeCompleteAuthSession();

// === FILL THESE WITH YOUR B2C SETTINGS ===
const tenant  = '<your-b2c-tenant>.b2clogin.com'; // e.g. contoso123.b2clogin.com
const policy  = '<signup_signin_policy>';         // e.g. B2C_1_SUSI
const clientId = '<your-mobile-client-id>';       // Application (client) ID of your Mobile app reg
const scope    = 'https://<your-tenant>.onmicrosoft.com/<api-app-id-uri>/bots.read openid profile offline_access';

/** Redirect URI — Expo picks the right value in dev */
const redirectUri = AuthSession.makeRedirectUri();

/** Azure AD B2C discovery (policy-specific endpoints) */
const discovery = {
  authorizationEndpoint: `https://${tenant}/oauth2/v2.0/authorize?p=${policy}`,
  tokenEndpoint:         `https://${tenant}/oauth2/v2.0/token?p=${policy}`,
  revocationEndpoint:    `https://${tenant}/oauth2/v2.0/logout?p=${policy}`,
};

export type Tokens = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
};

/** Interactive sign-in (opens the B2C web flow) */
export async function signInInteractive(): Promise<Tokens | null> {
  const request = new AuthSession.AuthRequest({
    clientId,
    responseType: AuthSession.ResponseType.Code,
    scopes: scope.split(' '),
    redirectUri,
    usePKCE: true,
  });

  // Build auth URL & launch the flow
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !('code' in result.params)) return null;

  // Exchange the code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: String(result.params.code),
    redirect_uri: redirectUri,
    code_verifier: request.codeVerifier || '',
  });

  const tokenRes = await fetch(discovery.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const tokens: Tokens = await tokenRes.json();
  return tokens && (tokens as any).access_token ? tokens : null;
}

/** Securely save tokens (Face ID/Touch ID is controlled at read time) */
export async function saveTokens(tokens: Tokens) {
  await SecureStore.setItemAsync('tokens', JSON.stringify(tokens), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** Prompt biometrics and return true if user authenticated */
export async function unlockWithBiometrics(): Promise<boolean> {
  const hw = await LocalAuthentication.hasHardwareAsync();
  if (!hw) return false;
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return false;
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock with Face ID' });
  return !!res.success;
}

/** Get stored tokens (optionally require Face ID/Touch ID first) */
export async function getStoredTokens(biometricRequired: boolean): Promise<Tokens | null> {
  if (biometricRequired) {
    const ok = await unlockWithBiometrics();
    if (!ok) return null;
  }
  const data = await SecureStore.getItemAsync('tokens');
  return data ? (JSON.parse(data) as Tokens) : null;
}

/** Clear saved tokens (sign out) */
export async function clearTokens() {
  await SecureStore.deleteItemAsync('tokens');
}
