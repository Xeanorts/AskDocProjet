#!/usr/bin/env node

/**
 * List Emails Utility
 * CLI tool to list and view stored emails
 */

import fileStorage from '../src/persistence/file-storage.js';
import logger from '../src/utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Display help message
 */
function showHelp() {
  console.log(`
📧 Email Storage Utility

Usage:
  npm run list-emails              List all stored emails
  npm run list-emails -- <id>      Show details of specific email
  npm run list-emails -- --stats   Show storage statistics

Examples:
  npm run list-emails
  npm run list-emails -- 20251104_203000_abc123.json
  npm run list-emails -- --stats
  `);
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * List all emails
 */
async function listEmails() {
  try {
    const files = await fileStorage.listEmails();

    if (files.length === 0) {
      console.log('📭 No emails stored yet.');
      console.log('');
      console.log('Send an email to the SMTP server to see it here!');
      return;
    }

    console.log(`\n📬 Found ${files.length} stored email(s):\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const filename of files) {
      try {
        const email = await fileStorage.readEmail(filename);

        const from = email.from?.address || email.from?.text || 'unknown';
        const to = email.to.map(t => t.address).join(', ') || 'unknown';
        const subject = email.subject || '(no subject)';
        const date = new Date(email.date).toLocaleString();
        const size = formatBytes(email.size);

        console.log(`\n📄 ${filename}`);
        console.log(`   🆔 ID: ${email.id}`);
        console.log(`   👤 From: ${from}`);
        console.log(`   👥 To: ${to}`);
        console.log(`   📨 Subject: ${subject}`);
        console.log(`   📅 Date: ${date}`);
        console.log(`   📏 Size: ${size}`);
        console.log(`   📎 Attachments: ${email.attachments.length}`);
      } catch (error) {
        console.log(`   ❌ Error reading ${filename}: ${error.message}`);
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💡 To view email details: npm run list-emails -- <filename>');
    console.log('');
  } catch (error) {
    console.error('❌ Error listing emails:', error.message);
    process.exit(1);
  }
}

/**
 * Show email details
 */
async function showEmail(filename) {
  try {
    const email = await fileStorage.readEmail(filename);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 EMAIL DETAILS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    console.log(`\n🆔 ID: ${email.id}`);
    console.log(`📨 Subject: ${email.subject || '(no subject)'}`);
    console.log(`👤 From: ${email.from?.address || 'unknown'} ${email.from?.name ? `(${email.from.name})` : ''}`);
    console.log(`👥 To: ${email.to.map(t => `${t.address} ${t.name ? `(${t.name})` : ''}`).join(', ')}`);

    if (email.cc && email.cc.length > 0) {
      console.log(`📋 CC: ${email.cc.map(t => t.address).join(', ')}`);
    }

    console.log(`📅 Date: ${new Date(email.date).toLocaleString()}`);
    console.log(`🕐 Received: ${new Date(email.receivedAt).toLocaleString()}`);
    console.log(`📏 Size: ${formatBytes(email.size)}`);
    console.log(`💌 Message ID: ${email.messageId || 'N/A'}`);

    if (email.attachments && email.attachments.length > 0) {
      console.log(`\n📎 Attachments (${email.attachments.length}):`);
      email.attachments.forEach((att, i) => {
        console.log(`   ${i + 1}. ${att.filename} (${att.contentType}, ${formatBytes(att.size)})`);
      });
    }

    if (email.text) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📄 TEXT CONTENT:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(email.text);
    }

    if (email.html) {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🌐 HTML CONTENT: ${email.html.length} characters`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(email.html.substring(0, 500) + (email.html.length > 500 ? '...' : ''));
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  } catch (error) {
    console.error(`❌ Error reading email ${filename}:`, error.message);
    process.exit(1);
  }
}

/**
 * Show storage statistics
 */
async function showStats() {
  try {
    const stats = await fileStorage.getStats();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 STORAGE STATISTICS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`\n📬 Total emails: ${stats.emailCount}`);
    console.log(`💾 Total size: ${stats.totalSizeMB} MB (${stats.totalSizeBytes} bytes)`);
    console.log(`📁 Storage path: ${stats.storagePath}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  } catch (error) {
    console.error('❌ Error getting statistics:', error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // No arguments - list all emails
    await listEmails();
  } else if (args[0] === '--help' || args[0] === '-h') {
    showHelp();
  } else if (args[0] === '--stats') {
    await showStats();
  } else {
    // Show specific email
    await showEmail(args[0]);
  }
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
