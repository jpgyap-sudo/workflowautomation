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
