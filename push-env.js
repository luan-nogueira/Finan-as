const { spawnSync } = require('child_process');
const fs = require('fs');

const firebaseJson = fs.readFileSync('chave_firebase.json', 'utf8');

const envs = ['production', 'preview', 'development'];
for (const env of envs) {
  console.log(`Setting FIREBASE_SERVICE_ACCOUNT in ${env}...`);
  const res = spawnSync('npx.cmd', ['vercel', 'env', 'add', 'FIREBASE_SERVICE_ACCOUNT', env], {
    input: firebaseJson,
    encoding: 'utf8'
  });
  if (res.stderr && res.stderr.includes('already exists')) {
     console.log(`Removing old variable in ${env}...`);
     spawnSync('npx.cmd', ['vercel', 'env', 'rm', 'FIREBASE_SERVICE_ACCOUNT', env, '-y']);
     spawnSync('npx.cmd', ['vercel', 'env', 'add', 'FIREBASE_SERVICE_ACCOUNT', env], { input: firebaseJson, encoding: 'utf8' });
  }
}
console.log("Done.");
