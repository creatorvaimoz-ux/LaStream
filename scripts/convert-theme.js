/**
 * LaStream Theme Converter
 * Converts dark theme classes to light theme across all EJS templates
 * Run: node scripts/convert-theme.js
 */

const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, '..', 'views');

// Files to convert (content pages that still use dark theme)
const targetFiles = [
  'dashboard.ejs',
  'gallery.ejs',
  'settings.ejs',
  'playlist.ejs',
  'rotations.ejs',
  'history.ejs',
  'users.ejs',
];

// Replacement map - ORDER MATTERS (longer/more specific patterns first)
const replacements = [
  // Background colors - specific patterns first
  ['bg-gray-800/80', 'bg-white/90'],
  ['bg-gray-800/50', 'bg-white/80'],
  ['bg-gray-900/80', 'bg-slate-100/80'],
  ['bg-gray-900/50', 'bg-slate-50/80'],
  ['bg-gray-700/50', 'bg-slate-100'],
  ['bg-gray-700/30', 'bg-slate-50'],
  ['bg-dark-700/50', 'bg-slate-100'],
  ['bg-dark-900/50', 'bg-slate-50/80'],
  ['bg-dark-900/80', 'bg-slate-100/80'],
  ['bg-gray-900', 'bg-slate-50'],
  ['bg-gray-800', 'bg-white'],
  ['bg-gray-700', 'bg-slate-100'],
  ['bg-gray-600', 'bg-slate-200'],
  ['bg-dark-900', 'bg-slate-50'],
  ['bg-dark-800', 'bg-white'],
  ['bg-dark-700', 'bg-slate-100'],
  ['bg-dark-600', 'bg-slate-200'],

  // Hover backgrounds
  ['hover:bg-gray-700/50', 'hover:bg-slate-100'],
  ['hover:bg-gray-700', 'hover:bg-slate-100'],
  ['hover:bg-gray-600', 'hover:bg-slate-200'],
  ['hover:bg-gray-800', 'hover:bg-slate-50'],
  ['hover:bg-dark-700/50', 'hover:bg-slate-100'],
  ['hover:bg-dark-700', 'hover:bg-slate-100'],
  ['hover:bg-dark-600', 'hover:bg-slate-200'],

  // Border colors
  ['border-gray-700/50', 'border-slate-200'],
  ['border-gray-700', 'border-slate-200'],
  ['border-gray-600/50', 'border-slate-200'],
  ['border-gray-600', 'border-slate-300'],
  ['border-gray-500', 'border-slate-300'],
  ['border-dark-700', 'border-slate-200'],
  ['border-dark-600', 'border-slate-300'],

  // Divide colors
  ['divide-gray-700/50', 'divide-slate-200'],
  ['divide-gray-700', 'divide-slate-200'],
  ['divide-gray-600', 'divide-slate-300'],

  // Ring colors
  ['ring-gray-700', 'ring-slate-300'],
  ['ring-gray-600', 'ring-slate-300'],
  ['ring-dark-600', 'ring-slate-300'],
  ['ring-dark-700', 'ring-slate-300'],
  ['focus:ring-gray-600', 'focus:ring-slate-300'],
  ['focus:ring-gray-700', 'focus:ring-slate-300'],

  // Text colors - careful with these
  ['text-gray-300', 'text-slate-600'],
  ['text-gray-400', 'text-slate-500'],
  ['text-gray-500', 'text-slate-400'],
  ['text-gray-100', 'text-slate-800'],
  ['text-gray-200', 'text-slate-700'],

  // Hover text
  ['hover:text-white', 'hover:text-slate-900'],
  ['hover:text-gray-200', 'hover:text-slate-800'],
  ['hover:text-gray-300', 'hover:text-slate-700'],

  // Placeholder
  ['placeholder-gray-500', 'placeholder-slate-400'],
  ['placeholder-gray-400', 'placeholder-slate-400'],

  // Shadow adjustments for light theme
  ['shadow-xl', 'shadow-lg'],
  ['shadow-2xl', 'shadow-xl'],

  // Old primary color references
  ['hover:bg-blue-600', 'hover:bg-sky-700'],
  ['bg-blue-600', 'bg-primary'],
  ['text-blue-400', 'text-primary'],
  ['text-blue-500', 'text-primary'],
  ['hover:text-blue-400', 'hover:text-primary'],
  ['hover:text-blue-300', 'hover:text-primary'],
  ['border-blue-500', 'border-primary'],

  // Scrollbar colors
  ['scrollbar-thumb-gray-600', 'scrollbar-thumb-slate-300'],
  ['scrollbar-track-gray-800', 'scrollbar-track-slate-100'],
];

// text-white needs special handling - don't replace on button/badge contexts
function smartReplaceTextWhite(content) {
  // Replace text-white that is NOT on colored button elements
  // Strategy: replace all text-white, then restore on known button patterns
  
  let result = content;
  
  // First, replace all text-white with text-slate-800
  result = result.replace(/text-white/g, 'text-slate-800');
  
  // Then restore text-white on colored backgrounds (buttons, badges, pills)
  const coloredBgPatterns = [
    'bg-primary', 'bg-secondary',
    'bg-red-', 'bg-green-', 'bg-blue-', 'bg-yellow-', 'bg-orange-',
    'bg-purple-', 'bg-pink-', 'bg-indigo-', 'bg-teal-', 'bg-cyan-',
    'bg-emerald-', 'bg-sky-', 'bg-rose-', 'bg-amber-', 'bg-lime-',
    'bg-violet-', 'bg-fuchsia-',
  ];
  
  // For each line, check if it has a colored bg AND text-slate-800 (was text-white)
  const lines = result.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('text-slate-800')) {
      // Check if this element has a colored background
      const hasColoredBg = coloredBgPatterns.some(pattern => line.includes(pattern));
      
      // Also check for specific element patterns that should keep white text
      const isButtonOrBadge = /class="[^"]*(?:bg-primary|bg-red-|bg-green-|bg-blue-|bg-yellow-|bg-orange-|bg-purple-|bg-pink-|bg-indigo-|bg-emerald-|bg-sky-|bg-rose-)[^"]*text-slate-800/.test(line);
      
      if (isButtonOrBadge) {
        lines[i] = line.replace(/text-slate-800/g, 'text-white');
      }
    }
  }
  
  return lines.join('\n');
}

// Process each file
let totalChanges = 0;

targetFiles.forEach(filename => {
  const filepath = path.join(viewsDir, filename);
  
  if (!fs.existsSync(filepath)) {
    console.log(`⏭️  Skipped: ${filename} (not found)`);
    return;
  }
  
  let content = fs.readFileSync(filepath, 'utf8');
  const originalContent = content;
  
  // Apply all replacements
  replacements.forEach(([from, to]) => {
    content = content.split(from).join(to);
  });
  
  // Smart text-white replacement
  content = smartReplaceTextWhite(content);
  
  if (content !== originalContent) {
    fs.writeFileSync(filepath, content, 'utf8');
    const changeCount = originalContent.length - content.length;
    console.log(`✅ Updated: ${filename}`);
    totalChanges++;
  } else {
    console.log(`⏭️  No changes: ${filename}`);
  }
});

console.log(`\n🎨 Theme conversion complete! ${totalChanges} files updated.`);
console.log('💡 Tip: Check the app in browser and fix any remaining color issues manually.');
