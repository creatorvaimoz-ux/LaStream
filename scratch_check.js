// Full App Check Script
const db = require('./db/database');

setTimeout(() => {
  try {
    const dbInstance = db.getDb();

    // 1. Tables
    const tables = dbInstance.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log('=== DB TABLES ===');
    tables.forEach(t => console.log('  -', t.name));

    // 2. streams columns for new features
    const streamCols = dbInstance.prepare("PRAGMA table_info(streams)").all();
    console.log('\n=== STREAMS: New Columns ===');
    const streamNew = streamCols.filter(c =>
      ['youtube_closed_captions','youtube_monetization','is_youtube_api','youtube_broadcast_id','youtube_stream_id'].includes(c.name)
    );
    streamNew.forEach(c => console.log(`  ✅ ${c.name} (${c.type}) default=${c.dflt_value}`));

    // 3. rotation_items columns
    const riCols = dbInstance.prepare("PRAGMA table_info(rotation_items)").all();
    console.log('\n=== ROTATION_ITEMS: New Columns ===');
    const riNew = riCols.filter(c =>
      ['youtube_closed_captions','youtube_monetization','privacy','category'].includes(c.name)
    );
    riNew.forEach(c => console.log(`  ✅ ${c.name} (${c.type}) default=${c.dflt_value}`));

    // 4. Check model files exist
    const fs = require('fs');
    const path = require('path');
    const filesToCheck = [
      './models/Stream.js',
      './models/Rotation.js',
      './models/User.js',
      './models/YoutubeChannel.js',
      './services/youtubeService.js',
      './services/rotationService.js',
      './services/streamingService.js',
      './utils/encryption.js',
      './views/dashboard.ejs',
      './views/rotations.ejs',
    ];
    console.log('\n=== FILE EXISTENCE ===');
    filesToCheck.forEach(f => {
      const exists = fs.existsSync(path.join(__dirname, f));
      console.log(`  ${exists ? '✅' : '❌'} ${f}`);
    });

    // 5. Key feature checks in code
    console.log('\n=== CODE FEATURE CHECKS ===');
    const appJs = fs.readFileSync('./app.js', 'utf8');
    const checks = [
      { name: 'AI generate endpoint', pattern: '/api/ai/generate' },
      { name: 'ytClosedCaptions in youtube stream route', pattern: 'ytClosedCaptions' },
      { name: 'Bandwidth monitor endpoint', pattern: '/api/system/resources' },
      { name: 'Rotation API POST', pattern: "'/api/rotations'" },
    ];
    checks.forEach(({ name, pattern }) => {
      const found = appJs.includes(pattern);
      console.log(`  ${found ? '✅' : '❌'} ${name} (${pattern})`);
    });

    // 6. Check youtubeService for enableClosedCaptions
    const ytSvc = fs.readFileSync('./services/youtubeService.js', 'utf8');
    const ytChecks = [
      { name: 'enableClosedCaptions in broadcast insert', pattern: 'enableClosedCaptions' },
      { name: 'stream.youtube_closed_captions', pattern: 'stream.youtube_closed_captions' },
    ];
    console.log('\n=== youtubeService.js CHECKS ===');
    ytChecks.forEach(({ name, pattern }) => {
      const found = ytSvc.includes(pattern);
      console.log(`  ${found ? '✅' : '❌'} ${name}`);
    });

    // 7. Check rotationService for enableClosedCaptions
    const rotSvc = fs.readFileSync('./services/rotationService.js', 'utf8');
    const rotChecks = [
      { name: 'enableClosedCaptions in rotation broadcast', pattern: 'enableClosedCaptions' },
      { name: 'item.youtube_closed_captions', pattern: 'item.youtube_closed_captions' },
    ];
    console.log('\n=== rotationService.js CHECKS ===');
    rotChecks.forEach(({ name, pattern }) => {
      const found = rotSvc.includes(pattern);
      console.log(`  ${found ? '✅' : '❌'} ${name}`);
    });

    // 8. Check rotations.ejs for AI Generator
    const rotView = fs.readFileSync('./views/rotations.ejs', 'utf8');
    const rotViewChecks = [
      { name: 'AI Content Generator per item', pattern: 'generateRotationItemAI' },
      { name: 'youtube_closed_captions checkbox in rotations', pattern: 'youtube_closed_captions' },
      { name: 'rotation-ai-prompt input', pattern: 'rotation-ai-prompt' },
    ];
    console.log('\n=== rotations.ejs CHECKS ===');
    rotViewChecks.forEach(({ name, pattern }) => {
      const found = rotView.includes(pattern);
      console.log(`  ${found ? '✅' : '❌'} ${name}`);
    });

    // 9. Check dashboard.ejs for AI & subtitle
    const dashView = fs.readFileSync('./views/dashboard.ejs', 'utf8');
    const dashChecks = [
      { name: 'pgAutoSubtitles checkbox', pattern: 'pgAutoSubtitles' },
      { name: 'AI Language selector', pattern: 'pgAILanguage' },
      { name: 'AI Style selector', pattern: 'pgAIStyle' },
      { name: 'generateAIContent function', pattern: 'generateAIContent' },
    ];
    console.log('\n=== dashboard.ejs CHECKS ===');
    dashChecks.forEach(({ name, pattern }) => {
      const found = dashView.includes(pattern);
      console.log(`  ${found ? '✅' : '❌'} ${name}`);
    });

    console.log('\n✅ ALL CHECKS COMPLETE');
    process.exit(0);
  } catch(e) {
    console.error('❌ CHECK FAILED:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}, 800);
