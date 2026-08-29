"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const keystore = path.join(androidDir, "upload-keystore.jks");
const properties = path.join(androidDir, "keystore.properties");
const backup = path.join(root, ".android-tools", "upload-key-backup.txt");

if (fs.existsSync(keystore) || fs.existsSync(properties)) {
  throw new Error("Upload key already exists; refusing to overwrite it.");
}

const jdkRoot = path.join(root, ".android-tools", "jdk");
const jdk = fs.readdirSync(jdkRoot, { withFileTypes: true }).find(entry => entry.isDirectory());
if (!jdk) throw new Error("Local JDK was not found.");
const keytool = path.join(jdkRoot, jdk.name, "bin", "keytool.exe");
const password = crypto.randomBytes(24).toString("base64url");

execFileSync(keytool, [
  "-genkeypair", "-v",
  "-keystore", keystore,
  "-storepass", password,
  "-keypass", password,
  "-alias", "upload",
  "-keyalg", "RSA",
  "-keysize", "2048",
  "-validity", "10000",
  "-dname", "CN=Tank Attack and Defend, OU=Game, O=TankAD, L=Ho Chi Minh City, C=VN"
], { stdio: "ignore" });

fs.writeFileSync(properties, [
  "storeFile=upload-keystore.jks",
  `storePassword=${password}`,
  "keyAlias=upload",
  `keyPassword=${password}`,
  ""
].join("\n"));

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.writeFileSync(backup, [
  "Tank Attack and Defend — Google Play upload key",
  `Package ID: com.tankad.game`,
  `Keystore: ${keystore}`,
  "Alias: upload",
  `Password: ${password}`,
  "",
  "Back up this file and upload-keystore.jks securely. Losing the upload key may block future updates."
].join("\n"));

console.log("Android upload key created. Back up .android-tools/upload-key-backup.txt and android/upload-keystore.jks securely.");
