import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

let driveClient: drive_v3.Drive | null = null;
let driveAuth: any = null;

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  // Priority 1: OAuth 2.0 tokens (user's personal Drive with storage quota)
  const oauthClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const oauthClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const oauthTokenPath = process.env.GOOGLE_DRIVE_OAUTH_TOKEN_PATH;

  if (oauthClientId && oauthClientSecret && oauthTokenPath && existsSync(oauthTokenPath)) {
    const tokens = JSON.parse(readFileSync(oauthTokenPath, 'utf-8'));
    const auth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
    auth.setCredentials(tokens);

    // Auto-refresh token if expired
    auth.on('tokens', (newTokens) => {
      if (newTokens.refresh_token) {
        const updated = { ...tokens, ...newTokens };
        try {
          writeFileSync(oauthTokenPath, JSON.stringify(updated, null, 2));
        } catch { /* ignore write errors */ }
      }
    });

    driveAuth = auth;
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
  }

  // Priority 2: Service account (server-to-server, no storage quota)
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let credentials: { client_email: string; private_key: string };
  if (credPath) {
    credentials = JSON.parse(readFileSync(credPath, 'utf-8'));
  } else if (credJson) {
    credentials = JSON.parse(credJson);
  } else {
    throw new Error(
      'Google Drive credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_DRIVE_CLIENT_ID/GOOGLE_DRIVE_CLIENT_SECRET/GOOGLE_DRIVE_OAUTH_TOKEN_PATH.'
    );
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
  });

  driveAuth = auth;
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Refresh the OAuth2 access token if it's expired.
 * Call this before each Drive operation to prevent token expiry errors.
 */
async function ensureFreshToken(): Promise<void> {
  if (!driveAuth) return;
  try {
    // Only OAuth2 has refreshAccessToken; JWT handles it internally
    if (driveAuth.refreshAccessToken) {
      const tokenInfo = await driveAuth.getAccessToken();
      if (!tokenInfo.token) {
        await driveAuth.refreshAccessToken();
      }
    }
  } catch {
    // If refresh fails, the next Drive call will throw a clearer error
  }
}

/**
 * Retry wrapper for transient Google Drive API errors.
 * Retries on: 429 (rate limit), 5xx (server errors), network/timeout errors.
 * Does NOT retry on: 4xx client errors (except 429).
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Refresh token before each attempt
      await ensureFreshToken();
      return await fn();
    } catch (error: any) {
      lastError = error;
      const status = error?.response?.status;
      const isTransient =
        status === 429 || // rate limit
        (status >= 500 && status < 600) || // server error
        status === undefined || // network error (no response)
        error?.code === 'ECONNRESET' ||
        error?.code === 'ETIMEDOUT' ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('rateLimit') ||
        error?.message?.includes('quota');

      if (!isTransient || attempt >= maxRetries) {
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Upload a file buffer to Google Drive.
 */
export async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentFolderId?: string
): Promise<UploadResult> {
  const drive = getDriveClient();
  const folderId = parentFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const requestBody: drive_v3.Schema$File = {
    name: fileName,
    parents: folderId ? [folderId] : [],
  };

  const media = {
    mimeType,
    body: Readable.from(fileBuffer),
  };

  return withRetry(async () => {
    const response = await drive.files.create({
      requestBody,
      media,
      fields: 'id,webViewLink,name,mimeType,size',
      supportsAllDrives: true,
    });
    return response.data as unknown as UploadResult;
  });
}
