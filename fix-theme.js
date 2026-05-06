const fs = require('fs');
let f = fs.readFileSync('views/dashboard.ejs', 'utf8');

// Card containers
f = f.replace(/bg-slate-800 rounded-xl border border-slate-700/g, 'bg-white rounded-xl border border-slate-200 shadow-sm');
f = f.replace(/border-b border-slate-700/g, 'border-b border-slate-100');

// Input/select fields
f = f.replace(/bg-slate-900 border border-slate-600 rounded-lg text-white/g, 'bg-slate-50 border border-slate-300 rounded-lg text-slate-800');
f = f.replace(/bg-slate-900\/50 border border-slate-700/g, 'bg-slate-100 border border-slate-200');
f = f.replace(/placeholder-slate-500/g, 'placeholder-slate-400');

// Small inputs
f = f.replace(/bg-slate-900 border border-slate-600 rounded-lg text-xs/g, 'bg-slate-50 border border-slate-300 rounded-lg text-xs');

// Checkbox
f = f.replace(/border-slate-600 bg-slate-900 text-primary/g, 'border-slate-300 bg-white text-primary');

// Toggle switches
f = f.replace(/bg-slate-600 rounded-full peer/g, 'bg-slate-300 rounded-full peer');

// Info boxes
f = f.replace(/bg-emerald-900\/30 border border-emerald-700\/40/g, 'bg-emerald-50 border border-emerald-200');
f = f.replace(/text-emerald-300\/80/g, 'text-emerald-600');
f = f.replace(/bg-yellow-900\/30 border border-yellow-700\/40/g, 'bg-yellow-50 border border-yellow-200');
f = f.replace(/text-yellow-300\/80/g, 'text-yellow-700');

// Feature boxes
f = f.replace(/bg-slate-900\/60 rounded-lg p-4 border border-slate-700/g, 'bg-slate-50 rounded-lg p-4 border border-slate-200');

// Tab bar
f = f.replace(/bg-slate-900 rounded-lg p-1/g, 'bg-slate-100 rounded-lg p-1');

// Stream list items  
f = f.replace(/bg-slate-900 rounded-lg hover:bg-slate-700\/50/g, 'bg-slate-50 rounded-lg hover:bg-slate-100');

// Empty state box
f = f.replace(/bg-slate-900 rounded-lg p-3 text-center/g, 'bg-slate-50 rounded-lg p-3 text-center');

// Headings
f = f.replace(/font-semibold text-white text-sm/g, 'font-semibold text-slate-800 text-sm');

// White text to dark
f = f.replace(/text-xs font-medium text-white/g, 'text-xs font-medium text-slate-700');

// Hover
f = f.replace(/text-slate-400 hover:text-white/g, 'text-slate-400 hover:text-slate-700');

// Bottom bar
f = f.replace(/bg-slate-800 border-t border-slate-700/g, 'bg-white border-t border-slate-200 shadow-lg');
f = f.replace(/bg-slate-700 hover:bg-slate-600 text-white/g, 'bg-slate-100 hover:bg-slate-200 text-slate-700');

// Dashed border
f = f.replace(/border-2 border-dashed border-slate-600/g, 'border-2 border-dashed border-slate-300');

// JS-generated info box colors (in pgToggleEncoding function)
f = f.replace(/bg-sky-900\/30 border border-sky-700\/40/g, 'bg-sky-50 border border-sky-200');
f = f.replace(/text-sky-300\/80/g, 'text-sky-600');

// Stream list text color in JS
f = f.replace(/text-xs font-medium text-white truncate/g, 'text-xs font-medium text-slate-800 truncate');

// color-scheme dark for datetime inputs
f = f.replace(/\[color-scheme:dark\]/g, '');

fs.writeFileSync('views/dashboard.ejs', f, 'utf8');
console.log('Theme converted to light!');
