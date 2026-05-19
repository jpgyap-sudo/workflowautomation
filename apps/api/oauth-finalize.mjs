/**
 * Finalize OAuth setup with the authorization code.
 * Usage: node oauth-finalize.mjs YOUR_AUTH_CODE
 */

import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = resolve(__dirname, '..', '..', 'credentials', 'oauth-token.json');

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

const code = process.argv[2];
if (!code) {
  console.error('Usage: node oauth-finalize.mjs YOUR_AUTH_CODE');
  process.exit(1);
}

// Clean the code - remove any URL fragments or extra params
const cleanCode = code.split('&')[0].split('#')[0].trim();

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

console.log('ðŸ”„ Exchanging code for tokens...');
const { tokens } = await oauth2Client.getToken(cleanCode);
writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
console.log('âœ… Tokens saved to credentials/oauth-token.json');
console.log(`   Access Token: ${tokens.access_token ? 'âœ“' : 'âœ—'}`);
console.log(`   Refresh Token: ${tokens.refresh_token ? 'âœ“' : 'âœ—'}`);

// Test
console.log('\nðŸ” Testing connection...');
oauth2Client.setCredentials(tokens);
const drive = google.drive({ version: 'v3', auth: oauth2Client });

const about = await drive.about.get({ fields: 'user,storageQuota' });
console.log(`âœ… Authenticated as: ${about.data.user?.displayName} (${about.data.user?.emailAddress})`);

const rootFolderId = '1aMNQB7wtuyRI1B1f7Of1Mid2QbU-GK-4';
const folder = await drive.files.get({
  fileId: rootFolderId,
  fields: 'id,name,mimeType,webViewLink',
  supportsAllDrives: true,
});
console.log(`âœ… Can access folder: "${folder.data.name}"`);

// Upload test
console.log('\nðŸ“„ Testing file upload...');
const testContent = Buffer.from(`OAuth test at ${new Date().toISOString()}`);

const uploaded = await drive.files.create({
  requestBody: { name: 'oauth-test.txt', parents: [rootFolderId] },
  media: { mimeType: 'text/plain', body: Readable.from(testContent) },
  fields: 'id,webViewLink,name',
  supportsAllDrives: true,
});
console.log(`âœ… Uploaded: "${uploaded.data.name}" â†’ ${uploaded.data.webViewLink}`);
await drive.files.delete({ fileId: uploaded.data.id, supportsAllDrives: true });
console.log('ðŸ§¹ Cleaned up');

console.log('\nðŸŽ‰ OAuth setup complete!');
