import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";
import { config } from "hardhat";

/**
 * Decrypts the deployer key and runs scripts/demo.ts on the chosen network
 */
async function main() {
  const networkIndex = process.argv.indexOf("--network");
  const networkName = networkIndex !== -1 ? process.argv[networkIndex + 1] : config.defaultNetwork;

  if (networkName === "localhost" || networkName === "hardhat") {
    // Deploy command on the localhost network
    const hardhat = spawn("hardhat", ["run", "scripts/demo.ts", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    hardhat.on("exit", code => {
      process.exit(code || 0);
    });
    return;
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;

  if (!encryptedKey) {
    console.log("🚫️ You don't have a deployer account. Run `yarn account:generate` or `yarn account:import` first");
    return;
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });

  try {
    const wallet = await Wallet.fromEncryptedJson(encryptedKey, pass);
    process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = wallet.privateKey;

    const hardhat = spawn("hardhat", ["run", "scripts/demo.ts", ...process.argv.slice(2)], {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    hardhat.on("exit", code => {
      process.exit(code || 0);
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }
}

main().catch(console.error);
