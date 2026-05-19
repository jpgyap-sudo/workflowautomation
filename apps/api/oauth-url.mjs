/**
 * Generate OAuth URL for Google Drive access.
 * Visit the URL, authenticate, then paste the code back here.
 * 
 * Usage: node scripts/oauth-url.mjs
 */

import { google } from 'googleapis';
import { createInterface } from 'readline';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = resolve(__dirname, '..', '..', 'credentials', 'oauth-token.json');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost:3000/oauth2callback'
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n' + '='.repeat(80));
console.log('ðŸ”— Open this URL in your browser and sign in with your Google account:');
console.log('='.repeat(80));
console.log(authUrl);
console.log('='.repeat(80) + '\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the authorization code from the browser: ', async (code) => {
  rl.close();
  
  console.log('\nðŸ”„ Exchanging code for tokens...');
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('âœ… Tokens saved to credentials/oauth-token.json');
    console.log(`   Access Token: ${tokens.access_token ? 'âœ“' : 'âœ—'}`);
    console.log(`   Refresh Token: ${tokens.refresh_token ? 'âœ“' : 'âœ—'}`);

    // Test the connection
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
    const { Readable } = await import('stream');
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
    console.log('The system will now use your Google Drive quota for uploads.');
  } catch (err) {
    console.error('\nâŒ Error:', err.message);
    process.exit(1);
  }
});
