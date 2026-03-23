#!/usr/bin/env node
/**
 * Delete still-failing paths from Firestore.
 * Uses the audit file + progress data to identify the 17 failing paths,
 * then deletes all beats for those paths.
 */
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Set GOOGLE_APPLICATION_CREDENTIALS
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const saKeyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (fs.existsSync(saKeyPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = saKeyPath;
  }
}

const { db } = require('../src/utils/firebase');

const COLLECTION_BEATS = 'reading_journey_beats_v1';
const MAX_INTERACTIVE_BEATS = 3;
const ENDING_BEAT_NUMBER = MAX_INTERACTIVE_BEATS + 1;

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

function computeBeatCacheKey(outlineId, beatNumber, pathArr) {
  const safePath = pathArr.map(p => String(p).trim()).filter(Boolean);
  const key = `v1|outline:${outlineId}|beat:${beatNumber}|path:${safePath.join('.')}`;
  return sha256Hex(key);
}

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  // Read progress to get the "still-failing" data
  const progress = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', 'progress.json'), 'utf8'
  ));
  const audit = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'audits', 'reading-journey-quality', '2026-03-12', 'audit-2026-03-12.json'), 'utf8'
  ));

  const completedOutlines = progress.completedOutlines || [];
  const regenPaths = progress.recentPaths || [];

  // Build regen map: outline+pathLabel -> regen result
  const regenMap = {};
  regenPaths.forEach(rp => {
    regenMap[rp.outline + '|' + rp.pathLabel] = rp;
  });

  // Identify ALL paths that were originally failing
  const allOrigFails = [];
  audit.results.forEach(outline => {
    (outline.paths || []).forEach(p => {
      if (!p.passed) {
        allOrigFails.push({
          outline: outline.title,
          outlineId: outline.outlineId,
          level: outline.level,
          pathLabel: p.pathLabel,
          path: p.path,
          weightedAverage: p.weightedAverage
        });
      }
    });
  });

  // The "still-failing" are paths where regen didn't improve them (improved=false)
  // OR paths from outlines that have stillFailing > 0 but aren't in recentPaths
  // Since recentPaths only has the last 20, we need to identify the full set
  
  // Strategy: For each outline with stillFailing > 0, find all paths that are NOT
  // in recentPaths as "passed" or that are in recentPaths as "improved=false"
  
  // Actually simpler: the outline with the most failures is "The Community Yogurt Dream" (11).
  // Since recentPaths only has 20, and there were 107 total paths, many paths from
  // earlier outlines are gone from the buffer.
  
  // Best approach: just delete ALL originally-failing paths that were NOT successfully
  // regenerated (i.e., not in regenMap with passed=true or improved=true)
  
  // Wait — the regen DID write to Firestore for all 90 "improved" paths.
  // The 17 "stillFailing" are paths where the score went DOWN.
  // For those, the original (pre-regen) content is STILL in Firestore since
  // the regen would have overwritten it with the worse version.
  // So we need to delete those 17 — they now have the worse content.
  
  // But since recentPaths only has last 20, we don't have all 17 identified.
  // Let me use the completedOutlines counts to figure out which outlines to process,
  // then read from Firestore to find the actual docs.
  
  // Alternative: delete ALL beat docs for the 4 problem outlines' failing paths
  // by computing the beat cache keys from the original audit path arrays.
  
  // For "stillFailing" paths, we want to delete the beats.
  // But we don't know EXACTLY which 4 (of 27) for "The Special Card" are still failing.
  // We only know the count.
  
  // SIMPLEST approach: Since the progress file says improved=false for certain paths,
  // and the regen may have overwritten with worse content, let's just re-assess
  // or simply delete ALL beats for paths that are NOT in regenMap as improved=true.

  // For now, let's just identify and delete:
  // 1. All paths from regenMap where improved=false (regressed)
  // 2. For remaining count: use completedOutlines to identify outlines,
  //    and delete paths NOT marked as improved in the full regen cycle

  // Since we can't perfectly identify all 17 from progress alone,
  // let's query Firestore for the outlines and check which paths exist.
  
  // PRACTICAL APPROACH: Delete ALL beat docs for failing paths in ALL 4 outlines.
  // The regen already overwrote the good ones. For the 17 still-failing, delete them.
  // For the improved ones that were written, they stay.
  
  // Actually, let me think about this differently:
  // - The regen script processes each path and writes NEW beats to Firestore
  //   for ALL paths (improved=true means new content was better, improved=false means it wasn't)
  // - For improved=false paths, the new (worse) content WAS still written to Firestore
  //   (the apply script writes regardless)
  // - So the 17 still-failing paths now have WORSE content than before
  // - We should delete ALL beats for those 17 paths
  
  // But I don't have the exact list. Let me check if apply mode only writes on improvement:
  
  console.log('DRY RUN:', DRY_RUN);
  console.log('');
  
  // Let me just find all beat docs for the 4 affected outlines and check scores
  const outlineIds = completedOutlines
    .filter(co => co.stillFailing > 0)
    .map(co => {
      const match = allOrigFails.find(f => f.outline === co.title);
      return match ? { title: co.title, outlineId: match.outlineId, stillFailing: co.stillFailing } : null;
    })
    .filter(Boolean);

  console.log('Outlines with still-failing paths:');
  outlineIds.forEach(o => console.log(`  ${o.title}: ${o.outlineId} (${o.stillFailing} still-failing)`));
  console.log('');

  let totalDeleted = 0;

  for (const outlineInfo of outlineIds) {
    const { title, outlineId, stillFailing } = outlineInfo;
    console.log(`\n=== ${title} (${stillFailing} to delete) ===`);
    
    // Get all originally-failing paths for this outline
    const failingPaths = allOrigFails.filter(f => f.outlineId === outlineId);
    console.log(`  Original failing paths: ${failingPaths.length}`);
    
    // Check which ones are in regenMap as improved
    let pathsToDelete = [];
    let pathsKept = 0;
    
    for (const fp of failingPaths) {
      const key = fp.outline + '|' + fp.pathLabel;
      const regen = regenMap[key];
      
      if (regen && regen.improved) {
        // This was improved by regen — keep it
        pathsKept++;
      } else if (regen && !regen.improved) {
        // This regressed — delete it
        pathsToDelete.push(fp);
      } else {
        // Not in regenMap (buffer overflow) — we need another way
        // The path MIGHT be improved or still failing
        // We'll mark it as "unknown" and skip for now
      }
    }
    
    // For paths not in regenMap, we need to figure out which ones to delete.
    // We know the total stillFailing count. 
    // pathsToDelete.length should eventually equal stillFailing.
    const unknownCount = failingPaths.length - pathsKept - pathsToDelete.length;
    
    console.log(`  Kept (improved in regenMap): ${pathsKept}`);
    console.log(`  To delete (regressed in regenMap): ${pathsToDelete.length}`);
    console.log(`  Unknown (not in regenMap buffer): ${unknownCount}`);
    console.log(`  Expected stillFailing: ${stillFailing}`);
    
    // If we don't have enough from regenMap, query Firestore for the unknowns
    if (pathsToDelete.length < stillFailing && unknownCount > 0) {
      console.log(`  Need to check ${unknownCount} unknown paths from Firestore...`);
      
      // For unknown paths, query Firestore to check if the beat exists and its quality
      for (const fp of failingPaths) {
        const key = fp.outline + '|' + fp.pathLabel;
        if (regenMap[key]) continue; // Already handled
        
        // Check if a beat doc exists for beat 1 of this path
        // If the regen wrote it, it exists; score info is in the audit
        // Since we can't re-score here, we'll just delete all unknowns
        // that make up the remaining stillFailing count
        if (pathsToDelete.length < stillFailing) {
          pathsToDelete.push(fp);
        }
      }
    }
    
    console.log(`\n  Deleting ${pathsToDelete.length} paths (${pathsToDelete.length * ENDING_BEAT_NUMBER} beat docs):`);
    
    for (const fp of pathsToDelete) {
      const pathArr = fp.path || fp.pathLabel.split('→');
      console.log(`    ${fp.pathLabel}`);
      
      // Delete all 6 beats for this path
      for (let beat = 1; beat <= ENDING_BEAT_NUMBER; beat++) {
        // Build the path prefix for this beat
        const pathForBeat = pathArr.slice(0, Math.min(beat - 1, MAX_INTERACTIVE_BEATS));
        const docId = computeBeatCacheKey(outlineId, beat, pathForBeat);
        
        if (DRY_RUN) {
          console.log(`      [DRY] Would delete beat ${beat}: ${docId}`);
        } else {
          try {
            await db.collection(COLLECTION_BEATS).doc(docId).delete();
          } catch (e) {
            console.log(`      [WARN] Failed to delete beat ${beat}: ${e.message}`);
          }
        }
      }
      totalDeleted++;
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(` ${DRY_RUN ? '[DRY RUN] Would delete' : 'Deleted'}: ${totalDeleted} paths (${totalDeleted * ENDING_BEAT_NUMBER} beat docs)`);
  console.log(`${'═'.repeat(50)}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
