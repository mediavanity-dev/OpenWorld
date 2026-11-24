#!/usr/bin/env node
// One-time (idempotent) edits to a fresh Capacitor 8 `android/` project so it
// builds a Play-ready, signed AAB on CI. Run from the app's root after
// `npx cap add android`:
//
//   node scripts/setup-android.mjs --plugin StandardsPlugin [--billing]
//
//  - applicationId and namespace = capacitor.config.json appId (permanent on Play)
//  - versionCode / versionName from env VERSION_CODE / VERSION_NAME (CI), else 1 / package.json version
//  - release signingConfig from env ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
//    ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD (unsigned when absent, so local debug builds still work)
//  - Play Billing Library 9.1.0 dependency (--billing)
//  - registers the app's own plugin in MainActivity, moving MainActivity into the app's package
//  - checks SDK levels (Play requires targetSdk 36 since 2026-08-31)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const plugin = opt('--plugin');            // Java class name of the app's own plugin, e.g. StandardsPlugin
const billing = args.includes('--billing');

const root = process.cwd();
const cap = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appId = cap.appId;
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) throw new Error(`appId ${appId} is not a valid Android package name`);

const A = (p) => path.join(root, 'android', p);
const read = (p) => fs.readFileSync(A(p), 'utf8');
const write = (p, s) => { fs.mkdirSync(path.dirname(A(p)), { recursive: true }); fs.writeFileSync(A(p), s); };
const done = [];

// --- app/build.gradle ---
let g = read('app/build.gradle');
g = g.replace(/namespace = "[^"]+"/, `namespace = "${appId}"`);
g = g.replace(/applicationId "[^"]+"/, `applicationId "${appId}"`);
g = g.replace(/versionCode [^\n]+/, `versionCode((System.getenv("VERSION_CODE") ?: "1") as Integer)`);
g = g.replace(/versionName [^\n]+/, `versionName(System.getenv("VERSION_NAME") ?: "${pkg.version}")`);
if (!g.includes('signingConfigs {')) {
  g = g.replace(/\n {4}buildTypes \{/, `
    signingConfigs {
        release {
            def ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {`);
  g = g.replace(/release \{\n(\s+)minifyEnabled false/, (m, sp) =>
    `release {\n${sp}if (System.getenv("ANDROID_KEYSTORE_PATH")) { signingConfig signingConfigs.release }\n${sp}minifyEnabled false`);
  done.push('release signing from env');
}
if (billing && !g.includes('com.android.billingclient:billing')) {
  g = g.replace(/dependencies \{\n/, `dependencies {\n    implementation "com.android.billingclient:billing:9.1.0"\n`);
  done.push('Play Billing 9.1.0');
}
write('app/build.gradle', g);
done.push(`applicationId/namespace ${appId}`, 'versionCode/versionName from env');

// --- variables.gradle: Play's target level ---
const v = read('variables.gradle');
const num = (k) => Number((v.match(new RegExp(`${k}\\s*=\\s*(\\d+)`)) || [])[1]);
if (num('targetSdkVersion') < 36 || num('compileSdkVersion') < 36) {
  write('variables.gradle', v.replace(/targetSdkVersion\s*=\s*\d+/, 'targetSdkVersion = 36').replace(/compileSdkVersion\s*=\s*\d+/, 'compileSdkVersion = 36'));
  done.push('target/compile SDK raised to 36');
}

// --- MainActivity in the app's package, registering the plugin ---
const javaRoot = 'app/src/main/java';
const want = path.join(javaRoot, ...appId.split('.'), 'MainActivity.java');
const found = [];
(function walk(d) { for (const e of fs.readdirSync(A(d), { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'MainActivity.java') found.push(p); } })(javaRoot);
let main = found.length ? read(found[0]) : 'public class MainActivity extends BridgeActivity {}\n';
main = main.replace(/^package [^;]+;/m, `package ${appId};`);
if (plugin && !main.includes(`registerPlugin(${plugin}.class)`)) {
  main = `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(${plugin}.class);   // before super.onCreate
        super.onCreate(savedInstanceState);
    }
}
`;
  done.push(`registers ${plugin}`);
}
for (const f of found) if (path.normalize(f) !== path.normalize(want)) fs.rmSync(A(f));
write(want, main);
if (plugin && !fs.existsSync(A(path.join(path.dirname(want), `${plugin}.java`))))
  console.warn(`! Copy assets/AppPlugin.java to android/${path.join(path.dirname(want), plugin + '.java')} and set its package/class.`);

console.log('setup-android:', done.join('; '));
