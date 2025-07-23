const axios = require("axios");
const fs = require("fs");
const path = require("path");
const https = require("https");
const unzipper = require("unzipper");

// Array of user IDs - will be populated by user
const userIds = [];

// Array to track failed downloads
const failedDownloads = [];

// Configuration
const BASE_URL =
  "https://ruidea-backend.herokuapp.com/inscripcion/link-archivos";
const BATCH_SIZE = 20; // Process 5 requests at a time
const DOWNLOAD_FOLDER = "./user-files";

// Ensure download folder exists
if (!fs.existsSync(DOWNLOAD_FOLDER)) {
  fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
}

// Function to extract user email from blob URL
function extractUserEmailFromBlobUrl(blobUrl) {
  // Extract email from URL like: https://ruideaalmacenamiento.blob.core.windows.net/ruidea/userEmail/uniqueString.zip
  const urlParts = blobUrl.split("/");
  const emailIndex = urlParts.findIndex((part) => part === "ruidea") + 1;
  return urlParts[emailIndex];
}

// Function to download and extract a single file
async function downloadAndExtractFile(blobUrl, userEmail) {
  try {
    const userFolder = path.join(DOWNLOAD_FOLDER, userEmail);
    const zipFilePath = path.join(userFolder, `${userEmail}.zip`);

    // Create user folder if it doesn't exist
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    // Download file
    const response = await axios({
      method: "GET",
      url: blobUrl,
      responseType: "stream",
      timeout: 30000, // 30 second timeout
    });

    const writer = fs.createWriteStream(zipFilePath);
    response.data.pipe(writer);

    // Wait for download to complete, then extract
    return new Promise((resolve, reject) => {
      writer.on("finish", async () => {
        console.log(`✅ Downloaded: ${userEmail}.zip`);

        try {
          // Extract the zip file
          await extractZipFile(zipFilePath, userFolder);
          console.log(`📁 Extracted files to: ${userFolder}`);

          // Remove the zip file after extraction
          fs.unlinkSync(zipFilePath);
          console.log(`🗑️  Removed zip file: ${userEmail}.zip`);

          resolve(userFolder);
        } catch (extractError) {
          console.error(
            `❌ Error extracting files for ${userEmail}:`,
            extractError.message
          );
          reject(extractError);
        }
      });
      writer.on("error", reject);
    });
  } catch (error) {
    console.error(`❌ Error downloading file for ${userEmail}:`, error.message);
    throw error;
  }
}

// Function to extract zip file
async function extractZipFile(zipFilePath, extractToPath) {
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipFilePath)
      .pipe(unzipper.Extract({ path: extractToPath }))
      .on("close", () => {
        resolve();
      })
      .on("error", (error) => {
        reject(error);
      });
  });
}

// Function to process a single user ID
async function processUserId(userId) {
  try {
    console.log(`🔄 Processing user ID: ${userId}`);

    // Get blob link
    const response = await axios.get(`${BASE_URL}/${userId}`, {
      timeout: 10000, // 10 second timeout
    });

    const blobUrl = response.data;
    const userEmail = extractUserEmailFromBlobUrl(blobUrl);

    console.log(`📁 Found blob for ${userEmail}: ${blobUrl}`);

    // Check if user folder already exists
    const userFolder = path.join(DOWNLOAD_FOLDER, userEmail);
    if (fs.existsSync(userFolder)) {
      console.log(`⏭️  Skipping ${userEmail} - folder already exists`);
      return { userId, userEmail, success: true, skipped: true };
    }

    // Download and extract the file
    await downloadAndExtractFile(blobUrl, userEmail);

    return { userId, userEmail, success: true };
  } catch (error) {
    console.error(`❌ Error processing user ID ${userId}:`, error.message);
    const failedItem = { userId, error: error.message };
    failedDownloads.push(failedItem);
    return { userId, success: false, error: error.message };
  }
}

// Function to process users in batches
async function processBatch(userIds) {
  const promises = userIds.map((userId) => processUserId(userId));
  return await Promise.all(promises);
}

// Main function to process all user IDs
async function processAllUsers() {
  if (userIds.length === 0) {
    console.log(
      "⚠️  No user IDs provided. Please add user IDs to the userIds array."
    );
    return;
  }

  console.log(`🚀 Starting download for ${userIds.length} users...`);
  console.log(`📦 Processing in batches of ${BATCH_SIZE}`);

  const results = [];

  // Process in batches
  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batch = userIds.slice(i, i + BATCH_SIZE);
    console.log(
      `\n📋 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
        userIds.length / BATCH_SIZE
      )}`
    );

    const batchResults = await processBatch(batch);
    results.push(...batchResults);

    // Small delay between batches to avoid overwhelming the server
    if (i + BATCH_SIZE < userIds.length) {
      console.log("⏳ Waiting 2 seconds before next batch...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Summary
  const successful = results.filter((r) => r.success && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n📊 Summary:");
  console.log(`✅ Successful: ${successful}`);
  console.log(`⏭️  Skipped: ${skipped}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ Failed user IDs:");
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`   - ${r.userId}: ${r.error}`);
      });

    console.log("\n📋 Failed downloads array (for manual checking):");
    console.log(JSON.stringify(failedDownloads, null, 2));
  }
}

// Run the script
processAllUsers().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
