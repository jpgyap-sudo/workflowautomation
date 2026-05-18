import { google, drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { readFileSync } from 'fs';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let driveClient: drive_v3.Drive | null = null;

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  let credentials: { client_email: string; private_key: string };
  if (credPath) {
    credentials = JSON.parse(readFileSync(credPath, 'utf-8'));
  } else if (credJson) {
    credentials = JSON.parse(credJson);
  } else {
    throw new Error(
      'Google Drive credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_JSON.'
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
  await drive.files.delete({ fileId });
}

/**
 * Get the download URL for a file (for streaming back to clients).
 */
export async function getDriveFileDownloadUrl(fileId: string): Promise<string> {
  const drive = getDriveClient();
  const file = await drive.files.get({
    fileId,
    fields: 'webContentLink,webViewLink',
  });
  return file.data.webContentLink ?? file.data.webViewLink ?? '';
}
