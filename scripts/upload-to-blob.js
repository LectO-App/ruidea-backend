require("dotenv").config();
const fs = require("fs");
const path = require("path");
const azureStorage = require("azure-storage");
const getStream = require("into-stream");

// Configuration
const ZIP_FILES_FOLDER = "./zip-files";
const BATCH_SIZE = 5; // Process 5 uploads at a time to avoid overwhelming the service
const CONTAINER_NAME = "ruidea"; // Azure blob container name
const PROGRESS_FILE = "./upload-progress.json"; // File to track progress

// Array to track failed uploads
const failedUploads = [];

// Create blob service
const blobService = azureStorage.createBlobService();

// Function to get command line arguments
function getCommandLineArgs() {
  const args = process.argv.slice(2);
  const startIndex = parseInt(args[0]) || 0;
  return { startIndex };
}

// Function to load progress from file
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
      console.log(`📋 Loaded progress: ${progress.completed} files completed`);
      return progress.completed || 0;
    }
  } catch (error) {
    console.log("⚠️  Could not load progress file, starting from beginning");
  }
  return 0;
}

// Function to save progress to file
function saveProgress(completedCount) {
  try {
    const progress = {
      completed: completedCount,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (error) {
    console.error("⚠️  Could not save progress:", error.message);
  }
}

// Function to get all zip files
function getZipFiles() {
  if (!fs.existsSync(ZIP_FILES_FOLDER)) {
    console.log("❌ Zip files folder doesn't exist. Run create-zips.js first.");
    return [];
  }

  const zipFiles = [];
  const userFolders = fs
    .readdirSync(ZIP_FILES_FOLDER, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  for (const userEmail of userFolders) {
    const userZipFolder = path.join(ZIP_FILES_FOLDER, userEmail);
    const files = fs
      .readdirSync(userZipFolder)
      .filter((file) => file.endsWith(".zip"))
      .map((file) => ({
        userEmail,
        fileName: file,
        localPath: path.join(userZipFolder, file),
        blobName: `${userEmail}/${file}`, // Structure: /${email}/${zipName}.zip
      }));

    zipFiles.push(...files);
  }

  return zipFiles;
}

// Function to upload a single zip file
async function uploadZipFile(zipFile) {
  try {
    console.log(`🔄 Uploading: ${zipFile.blobName}`);

    // Read the zip file
    const fileBuffer = fs.readFileSync(zipFile.localPath);
    const stream = getStream(fileBuffer);
    const streamLength = fileBuffer.length;

    // Upload to blob storage
    return new Promise((resolve, reject) => {
      blobService.createBlockBlobFromStream(
        CONTAINER_NAME,
        zipFile.blobName,
        stream,
        streamLength,
        (error) => {
          if (error) {
            console.error(
              `❌ Error uploading ${zipFile.blobName}:`,
              error.message
            );
            const failedItem = {
              userEmail: zipFile.userEmail,
              fileName: zipFile.fileName,
              error: error.message,
            };
            failedUploads.push(failedItem);
            reject(error);
          } else {
            console.log(`✅ Uploaded: ${zipFile.blobName}`);
            resolve({
              userEmail: zipFile.userEmail,
              fileName: zipFile.fileName,
              success: true,
            });
          }
        }
      );
    });
  } catch (error) {
    console.error(`❌ Error processing ${zipFile.blobName}:`, error.message);
    const failedItem = {
      userEmail: zipFile.userEmail,
      fileName: zipFile.fileName,
      error: error.message,
    };
    failedUploads.push(failedItem);
    return {
      userEmail: zipFile.userEmail,
      fileName: zipFile.fileName,
      success: false,
      error: error.message,
    };
  }
}

// Function to process uploads in batches
async function processBatch(zipFiles) {
  const promises = zipFiles.map((zipFile) => uploadZipFile(zipFile));
  return await Promise.all(promises);
}

// Function to process all uploads
async function processAllUploads() {
  const zipFiles = getZipFiles();

  if (zipFiles.length === 0) {
    console.log(
      "❌ No zip files found. Run create-zips.js first to create zip files."
    );
    return;
  }

  // Get starting index from command line or progress file
  const { startIndex } = getCommandLineArgs();
  const savedProgress = loadProgress();
  const actualStartIndex = startIndex > 0 ? startIndex : savedProgress;

  if (actualStartIndex >= zipFiles.length) {
    console.log("✅ All files have already been processed!");
    return;
  }

  // Skip already processed files
  const remainingFiles = zipFiles.slice(actualStartIndex);

  console.log(
    `🚀 Starting upload for ${remainingFiles.length} remaining zip files...`
  );
  console.log(
    `📍 Starting from index: ${actualStartIndex} (${actualStartIndex + 1}/${
      zipFiles.length
    })`
  );
  console.log(
    `📦 Processing in batches of ${BATCH_SIZE} to avoid overwhelming the service`
  );
  console.log(`📁 Container: ${CONTAINER_NAME}`);
  console.log(`🏗️  Structure: /${CONTAINER_NAME}/{userEmail}/{zipName}.zip`);

  const results = [];
  let completedCount = actualStartIndex;

  // Process in batches
  for (let i = 0; i < remainingFiles.length; i += BATCH_SIZE) {
    const batch = remainingFiles.slice(i, i + BATCH_SIZE);
    const currentBatchNumber =
      Math.floor((actualStartIndex + i) / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(zipFiles.length / BATCH_SIZE);

    console.log(`\n📋 Processing batch ${currentBatchNumber}/${totalBatches}`);

    const batchResults = await processBatch(batch);
    results.push(...batchResults);

    completedCount += batch.length;
    saveProgress(completedCount);

    // Small delay between batches to be respectful to the service
    if (i + BATCH_SIZE < remainingFiles.length) {
      console.log("⏳ Waiting 1 second before next batch...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n📊 Summary:");
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total completed: ${completedCount}/${zipFiles.length}`);

  if (failed > 0) {
    console.log("\n❌ Failed uploads:");
    results
      .filter((r) => !r.success)
      .forEach((upload) => {
        console.log(
          `   - ${upload.userEmail}/${upload.fileName}: ${upload.error}`
        );
      });

    console.log("\n📋 Failed uploads array (for manual checking):");
    console.log(JSON.stringify(failedUploads, null, 2));
  }

  if (successful > 0) {
    console.log("\n📁 Files uploaded to Azure Blob Storage");
    console.log(
      `🏗️  Structure: /${CONTAINER_NAME}/{userEmail}/{timestamp} - {userEmail}.zip`
    );
  }

  // Clean up progress file if all files are completed
  if (completedCount >= zipFiles.length) {
    try {
      fs.unlinkSync(PROGRESS_FILE);
      console.log("🧹 Progress file cleaned up");
    } catch (error) {
      console.log("⚠️  Could not clean up progress file");
    }
  }
}

// Run the script
processAllUploads().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
