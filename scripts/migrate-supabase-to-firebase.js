#!/usr/bin/env node

/**
 * Migra datos de Supabase a Firebase Firestore
 *
 * Uso:
 * node scripts/migrate-supabase-to-firebase.js
 *
 * Requiere variables de entorno:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_SERVICE_ACCOUNT_KEY (JSON)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const FIREBASE_KEY_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || './firebase-key.json';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Initialize Firebase
if (!fs.existsSync(FIREBASE_KEY_PATH)) {
  console.error(`Error: Firebase service account key not found at ${FIREBASE_KEY_PATH}`);
  console.error('Download it from Firebase Console > Project Settings > Service Accounts');
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(FIREBASE_KEY_PATH, 'utf8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const COLLECTIONS = [
  'areas',
  'projects',
  'tasks',
  'inbox_items',
  'resources',
  'wiki_pages',
  'user_folders',
  'user_files',
  'user_file_tags',
  'user_file_links',
  'api_tokens',
  'push_subscriptions',
  'allowed_emails',
];

async function migrateCollection(collectionName) {
  console.log(`\n📊 Migrating ${collectionName}...`);

  try {
    const { data, error } = await supabase.from(collectionName).select('*');

    if (error) throw error;

    if (!data || data.length === 0) {
      console.log(`  ✓ No data to migrate for ${collectionName}`);
      return 0;
    }

    console.log(`  Found ${data.length} records`);

    let migrated = 0;
    const batch = db.batch();
    const batchSize = 500;

    for (let i = 0; i < data.length; i++) {
      const doc = data[i];
      const docRef = db.collection(collectionName).doc(doc.id);

      // Convert snake_case to camelCase for Firestore
      const firestoreDoc = convertToFirestore(doc);

      batch.set(docRef, firestoreDoc);
      migrated++;

      // Commit batch every 500 docs
      if ((i + 1) % batchSize === 0) {
        await batch.commit();
        console.log(`  ✓ Committed ${i + 1} records`);
      }
    }

    // Final commit
    if (migrated % batchSize !== 0) {
      await batch.commit();
    }

    console.log(`  ✅ Migrated ${migrated} records to ${collectionName}`);
    return migrated;
  } catch (error) {
    console.error(`  ❌ Error migrating ${collectionName}:`, error.message);
    return 0;
  }
}

function convertToFirestore(doc) {
  const converted = { ...doc };

  // Handle timestamp fields
  const timestampFields = ['created_at', 'updated_at'];
  for (const field of timestampFields) {
    if (field in converted) {
      const camelField = field === 'created_at' ? 'createdAt' : 'updatedAt';
      const timestamp = converted[field];
      converted[camelField] = timestamp ? new Date(timestamp) : new Date();
      delete converted[field];
    }
  }

  // Convert snake_case to camelCase
  const mappings = {
    'area_id': 'areaId',
    'project_id': 'projectId',
    'task_number': 'taskNumber',
    'task_counter': 'taskCounter',
    'review_date': 'reviewDate',
    'entity_type': 'entityType',
    'entity_id': 'entityId',
    'parent_id': 'parentId',
    'file_name': 'fileName',
    'file_size': 'fileSize',
    'mime_type': 'mimeType',
    'storage_path': 'storagePath',
    'token_hash': 'tokenHash',
    'token_prefix': 'tokenPrefix',
    'expires_at': 'expiresAt',
    'last_used_at': 'lastUsedAt',
    'user_id': 'userId',
    'p256dh_key': 'p256dhKey',
    'auth_key': 'authKey',
    'device_info': 'deviceInfo',
    'code_challenge': 'codeChallenge',
    'code_challenge_method': 'codeChallengeMethod',
    'redirect_uri': 'redirectUri',
    'client_id': 'clientId',
    'used_at': 'usedAt',
  };

  for (const [snakeCase, camelCase] of Object.entries(mappings)) {
    if (snakeCase in converted) {
      converted[camelCase] = converted[snakeCase];
      delete converted[snakeCase];
    }
  }

  return converted;
}

async function runMigration() {
  console.log('🚀 Starting Supabase → Firebase migration...\n');
  console.log(`Source: ${SUPABASE_URL}`);
  console.log(`Destination: ${serviceAccount.project_id}\n`);

  let totalMigrated = 0;
  const startTime = Date.now();

  for (const collection of COLLECTIONS) {
    const count = await migrateCollection(collection);
    totalMigrated += count;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Migration complete!`);
  console.log(`   Total records migrated: ${totalMigrated}`);
  console.log(`   Duration: ${duration}s`);
  console.log(`\nNext steps:`);
  console.log(`1. Setup Firestore Security Rules`);
  console.log(`2. Test the app thoroughly`);
  console.log(`3. Verify all data is present and correct`);
}

runMigration().catch(error => {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
});
