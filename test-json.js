const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const match = env.match(/FIREBASE_SERVICE_ACCOUNT=\"([\s\S]*?)\"/);
if (match) {
  try {
    let jsonStr = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    JSON.parse(jsonStr);
    console.log('JSON IS VALID');
  } catch(e) {
    console.error('JSON ERROR:', e.message);
  }
} else {
  console.log('NOT FOUND');
}
