/**
 * Google Drive OAuth 2.0 Setup Script
 * 
 * Run this script to generate an OAuth URL.
 * Visit the URL in your browser, authenticate with your Google account,
 * and paste the authorization code back here.
 * 
 * Usage: node scripts/oauth-setup.mjs
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = resolve(__dirname, '..', 'credentials', 'google-service-account.json');
const TOKEN_PATH = resolve(__dirname, '..', 'credentials', 'oauth-token.json');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

async function main() {
  console.log('🔑 Google Drive OAuth 2.0 Setup\n');

  // Load the service account JSON to get project info
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf-8'));
  console.log(`📁 Using project: ${credentials.project_id}`);
  console.log(`📧 Service account: ${credentials.client_email}\n`);

  // For OAuth, we need a Client ID and Client Secret from Google Cloud Console.
  // Since we're using a service account, we'll use the service account's
  // client_id and set up domain-wide delegation, OR we create a new OAuth client.
  
  console.log('⚠️  To use OAuth 2.0 with your personal Google account, you need to:');
  console.log('');
  console.log('1. Go to https://console.cloud.google.com/apis/credentials');
  console.log(`   (Project: ${credentials.project_id})`);
  console.log('');
  console.log('2. Click "Create Credentials" → "OAuth client ID"');
  console.log('3. Choose "Desktop application" as application type');
  console.log('4. Name it "Quotation Automation OAuth"');
  console.log('5. Click "Create"');
  console.log('');
  console.log('6. Copy the Client ID and Client Secret shown in the popup');
  console.log('');
  console.log('7. Also add this redirect URI to the OAuth client:');
  console.log('   http://localhost:3000/oauth2callback');
  console.log('');

  // Ask for Client ID
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  
  const clientId = await new Promise((resolve) => {
    rl.question('Paste your OAuth Client ID: ', (answer) => {
      resolve(answer.trim());
    });
  });

  const clientSecret = await new Promise((resolve) => {
    rl.question('Paste your OAuth Client Secret: ', (answer) => {
      resolve(answer.trim());
    });
  });

  rl.close();

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:3000/oauth2callback'
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force to get refresh token
  });

  console.log('\n🔗 Open this URL in your browser:');
  console.log('\n' + '='.repeat(80));
  console.log(authUrl);
  console.log('='.repeat(80) + '\n');

  // Ask for the authorization code
  const rl2 = createInterface({ input: process.stdin, output: process.stdout });
  
  const code = await new Promise((resolve) => {
    rl2.question('Paste the authorization code from the browser: ', (answer) => {
      resolve(answer.trim());
    });
  });

  rl2.close();

  // Exchange code for tokens
  console.log('\n🔄 Exchanging authorization code for tokens...');
  const { tokens } = await oauth2Client.getToken(code);
  
  console.log('✅ Tokens received!');
  console.log(`   Access Token: ${tokens.access_token ? '✓' : '✗'}`);
  console.log(`   Refresh Token: ${tokens.refresh_token ? '✓' : '✗'}`);
  console.log(`   Expires: ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'N/A'}`);

  // Save tokens
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`\n💾 Tokens saved to: ${TOKEN_PATH}`);

  // Test the connection
  console.log('\n🔍 Testing connection...');
  oauth2Client.setCredentials(tokens);
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  try {
    const about = await drive.about.get({ fields: 'user,storageQuota' });
    console.log(`✅ Authenticated as: ${about.data.user?.displayName} (${about.data.user?.emailAddress})`);
    
    const quota = about.data.storageQuota;
    if (quota) {
      const used = parseInt(quota.usage ?? '0');
      const limit = parseInt(quota.limit ?? '0');
      console.log(`💾 Storage: ${(used / 1024 / 1024).toFixed(1)}MB / ${(limit / 1024 / 1024 / 1024).toFixed(1)}GB used`);
    }

    // Test: List files in the root folder
    const rootFolderId = '1aMNQB7wtuyRI1B1f7Of1Mid2QbU-GK-4';
    const folder = await drive.files.get({
      fileId: rootFolderId,
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: true,
    });
    console.log(`✅ Can access folder: "${folder.data.name}"`);
    console.log(`🔗 ${folder.data.webViewLink}`);

    // Test: Upload a small file
    console.log('\n📄 Testing file upload...');
    const testContent = Buffer.from(`OAuth test at ${new Date().toISOString()}`);
    const { Readable } = await import('stream');
    
    const uploaded = await drive.files.create({
      requestBody: {
        name: 'oauth-test.txt',
        parents: [rootFolderId],
      },
      media: {
        mimeType: 'text/plain',
        body: Readable.from(testContent),
      },
      fields: 'id,webViewLink,name',
      supportsAllDrives: true,
    });

    console.log(`✅ Uploaded: "${uploaded.data.name}"`);
    console.log(`🔗 ${uploaded.data.webViewLink}`);

    // Cleanup
    await drive.files.delete({ fileId: uploaded.data.id, supportsAllDrives: true });
    console.log('🧹 Cleaned up test file');

    console.log('\n🎉 OAuth setup complete!');
    console.log('📝 Update your .env file with:');
    console.log(`GOOGLE_DRIVE_CLIENT_ID=${clientId}`);
    console.log(`GOOGLE_DRIVE_CLIENT_SECRET=${clientSecret}`);
    console.log('GOOGLE_DRIVE_OAUTH_TOKEN_PATH=/app/credentials/oauth-token.json');
    console.log('\nThen restart the services.');

  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exit(1);
  }
}

main().catch(console.error);
