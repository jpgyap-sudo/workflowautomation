import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SCOPES = ['https://www.googleapis.com/auth/drive'];

let driveClient: drive_v3.Drive | null = null;

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

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
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
 * @param fileBuffer - The file content as Buffer
 * @param fileName - The desired file name in Drive
 * @param mimeType - MIME type (e.g., 'application/pdf', 'image/jpeg')
 * @param parentFolderId - Optional parent folder ID (defaults to GOOGLE_DRIVE_ROOT_FOLDER_ID)
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

  const response = await drive.files.create({
    requestBody,
    media,
    fields: 'id,webViewLink,name,mimeType,size',
    supportsAllDrives: true,
  });

  return response.data as unknown as UploadResult;
}

/**
 * Create a folder inside a parent folder on Google Drive.
 */
export async function createDriveFolder(
  folderName: string,
  parentFolderId?: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDriveClient();
  const folderId = parentFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  const response = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: folderId ? [folderId] : [],
    },
    fields: 'id,webViewLink',
    supportsAllDrives: true,
  });

  return response.data as { id: string; webViewLink: string };
}

/**
 * Get or create a folder by name inside a parent.
 * Searches for an existing folder first; creates one if not found.
 */
export async function getOrCreateFolder(
  folderName: string,
  parentFolderId?: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDriveClient();
  const folderId = parentFolderId ?? process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  // Search for existing folder with this name
  const query = `name='${folderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${folderId}' in parents and trashed=false`;
  const res = await drive.files.list({
    q: query,
    fields: 'files(id,webViewLink)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0] as { id: string; webViewLink: string };
  }

  // Create if not found
  return createDriveFolder(folderName, parentFolderId);
}

/**
 * Delete a file from Google Drive by its file ID.
 */
export async function deleteDriveFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}

/**
 * Get the download URL for a file (for streaming back to clients).
 */
export async function getDriveFileDownloadUrl(fileId: string): Promise<string> {
  const drive = getDriveClient();
  const file = await drive.files.get({
    fileId,
    fields: 'webContentLink,webViewLink',
    supportsAllDrives: true,
  });
  return file.data.webContentLink ?? file.data.webViewLink ?? '';
}

/**
 * Get or create a month folder (YYYY-MM format) under the root.
 * E.g. "2026-05" for May 2026.
 * Uses Philippines timezone (Asia/Manila) so month folders align with PHT.
 */
export async function getOrCreateMonthFolder(
  date: Date = new Date()
): Promise<{ id: string; webViewLink: string }> {
  // Convert to Philippines timezone for consistent month folder naming
  const pht = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
  const year = pht.getFullYear();
  const month = String(pht.getMonth() + 1).padStart(2, '0');
  const folderName = `${year}-${month}`;
  return getOrCreateFolder(folderName);
}

/**
 * Get or create a client/project folder inside a month folder.
 * Folder name format: "ClientName - QTN-2026-001"
 */
export async function getOrCreateClientFolder(
  clientName: string,
  quotationNumber: string,
  monthFolderId: string
): Promise<{ id: string; webViewLink: string }> {
  const folderName = `${clientName} - ${quotationNumber}`;
  return getOrCreateFolder(folderName, monthFolderId);
}
