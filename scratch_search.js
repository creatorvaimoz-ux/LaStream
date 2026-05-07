const fs = require('fs');
const lines = fs.readFileSync('app.js', 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].toLowerCase().includes('/generate') || lines[i].toLowerCase().includes('generate')) {
    if (lines[i].includes('app.post(') || lines[i].includes('app.get(')) {
      console.log(`Line ${i+1}: ${lines[i].trim()}`);
    }
  }
}
