const fs = require("fs");
const path = require("path");
const Zip = require("jszip");

// Configuration
const USER_FILES_FOLDER = "./user-files";
const ZIP_FILES_FOLDER = "./zip-files";
const BATCH_SIZE = 10; // Process 10 users in parallel
const CURSOR_FILE = "./zip-creation-cursor.json";

// Array to track failed operations
const failedOperations = [];

// Ensure zip-files folder exists
if (!fs.existsSync(ZIP_FILES_FOLDER)) {
  fs.mkdirSync(ZIP_FILES_FOLDER, { recursive: true });
}

// Function to load cursor state
function loadCursor() {
  if (fs.existsSync(CURSOR_FILE)) {
    try {
      const cursorData = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8"));
      return cursorData;
    } catch (error) {
      console.log("⚠️  Error reading cursor file, starting from beginning");
      return { currentBatch: 0, totalBatches: 0, processedUsers: [] };
    }
  }
  return { currentBatch: 0, totalBatches: 0, processedUsers: [] };
}

// Function to save cursor state
function saveCursor(cursorData) {
  fs.writeFileSync(CURSOR_FILE, JSON.stringify(cursorData, null, 2));
}

// Function to reset cursor
function resetCursor() {
  if (fs.existsSync(CURSOR_FILE)) {
    fs.unlinkSync(CURSOR_FILE);
    console.log("🔄 Cursor reset - will start from beginning");
  }
}

// Function to get all user folders
function getUserFolders() {
  if (!fs.existsSync(USER_FILES_FOLDER)) {
    console.log("❌ User files folder doesn't exist. Run get-files.js first.");
    return [];
  }

  const folders = fs
    .readdirSync(USER_FILES_FOLDER, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  return folders;
}

// Function to create zip from user folder
async function createZipFromUserFolder(userEmail) {
  try {
    const userFolderPath = path.join(USER_FILES_FOLDER, userEmail);
    const userZipFolder = path.join(ZIP_FILES_FOLDER, userEmail);

    // Create user zip folder if it doesn't exist
    if (!fs.existsSync(userZipFolder)) {
      fs.mkdirSync(userZipFolder, { recursive: true });
    }

    // Check if user folder exists and has files
    if (!fs.existsSync(userFolderPath)) {
      console.log(`⚠️  User folder not found: ${userEmail}`);
      const failedItem = { userEmail, error: "User folder not found" };
      failedOperations.push(failedItem);
      return { userEmail, success: false, error: "User folder not found" };
    }

    const files = fs.readdirSync(userFolderPath);
    if (files.length === 0) {
      console.log(`⚠️  No files found in folder: ${userEmail}`);
      const failedItem = { userEmail, error: "No files found" };
      failedOperations.push(failedItem);
      return { userEmail, success: false, error: "No files found" };
    }

    console.log(
      `🔄 Creating zip for ${userEmail} with ${files.length} files...`
    );

    // Create zip
    const zip = new Zip();

    // Add each file to the zip
    for (const file of files) {
      const filePath = path.join(userFolderPath, file);
      const fileContent = fs.readFileSync(filePath);
      zip.file(file, fileContent);
    }

    // Generate zip buffer
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 9,
      },
    });

    // Create filename with timestamp
    const timestamp = new Date().toISOString();
    const zipFileName = `${timestamp} - ${userEmail}.zip`;
    const zipFilePath = path.join(userZipFolder, zipFileName);

    // Write zip file
    fs.writeFileSync(zipFilePath, buffer);

    console.log(`✅ Created zip: ${zipFileName}`);
    return { userEmail, success: true, zipFileName, fileCount: files.length };
  } catch (error) {
    console.error(`❌ Error creating zip for ${userEmail}:`, error.message);
    const failedItem = { userEmail, error: error.message };
    failedOperations.push(failedItem);
    return { userEmail, success: false, error: error.message };
  }
}

// Function to process users in batches for parallel processing
async function processBatch(userEmails) {
  const promises = userEmails.map((userEmail) =>
    createZipFromUserFolder(userEmail)
  );
  return await Promise.all(promises);
}

// Function to process all users with cursor support
async function processAllUsers() {
  const userFolders = getUserFolders();

  if (userFolders.length === 0) {
    console.log(
      "❌ No user folders found. Run get-files.js first to download files."
    );
    return;
  }

  // Load cursor state
  let cursor = loadCursor();
  const totalBatches = Math.ceil(userFolders.length / BATCH_SIZE);

  // Check for command line arguments
  const args = process.argv.slice(2);
  if (args.includes("--reset")) {
    resetCursor();
    cursor = { currentBatch: 0, totalBatches, processedUsers: [] };
  } else if (args.includes("--start-batch")) {
    const startBatchIndex = args.indexOf("--start-batch");
    if (startBatchIndex + 1 < args.length) {
      const startBatch = parseInt(args[startBatchIndex + 1]);
      if (startBatch >= 0 && startBatch < totalBatches) {
        cursor.currentBatch = startBatch;
        cursor.totalBatches = totalBatches;
        cursor.processedUsers = [];
        console.log(`🚀 Starting from batch ${startBatch + 1}/${totalBatches}`);
      } else {
        console.log(
          `❌ Invalid batch number. Must be between 0 and ${totalBatches - 1}`
        );
        return;
      }
    } else {
      console.log("❌ --start-batch requires a batch number");
      return;
    }
  } else if (cursor.currentBatch > 0) {
    console.log(
      `🔄 Resuming from batch ${cursor.currentBatch + 1}/${totalBatches}`
    );
  }

  console.log(`🚀 Starting zip creation for ${userFolders.length} users...`);
  console.log(`📦 Processing in batches of ${BATCH_SIZE} for maximum speed`);

  const results = [];

  // Process in batches for parallel processing
  for (
    let i = cursor.currentBatch * BATCH_SIZE;
    i < userFolders.length;
    i += BATCH_SIZE
  ) {
    const currentBatchNumber = Math.floor(i / BATCH_SIZE);
    const batch = userFolders.slice(i, i + BATCH_SIZE);

    console.log(
      `\n📋 Processing batch ${currentBatchNumber + 1}/${totalBatches}`
    );

    // Update cursor
    cursor.currentBatch = currentBatchNumber;
    cursor.totalBatches = totalBatches;
    saveCursor(cursor);

    const batchResults = await processBatch(batch);
    results.push(...batchResults);

    // Update processed users in cursor
    cursor.processedUsers.push(...batchResults.map((r) => r.userEmail));
    saveCursor(cursor);
  }

  // Clear cursor when done
  if (fs.existsSync(CURSOR_FILE)) {
    fs.unlinkSync(CURSOR_FILE);
    console.log("✅ Cursor cleared - process completed");
  }

  // Summary
  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n📊 Summary:");
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ Failed users:");
    results
      .filter((r) => !r.success)
      .forEach((user) => {
        console.log(`   - ${user.userEmail}: ${user.error}`);
      });

    console.log("\n📋 Failed operations array (for manual checking):");
    console.log(JSON.stringify(failedOperations, null, 2));
  }

  if (successful > 0) {
    console.log("\n📁 Zip files created in ./zip-files/");
    console.log("Structure: ./zip-files/{email}/{timestamp} - {email}.zip");
    console.log("💾 Original user folders preserved in ./user-files/");
  }
}

// Show usage information
function showUsage() {
  console.log("\n📖 Usage:");
  console.log(
    "  node create-zips.js                    # Start from beginning or resume"
  );
  console.log(
    "  node create-zips.js --reset            # Reset cursor and start from beginning"
  );
  console.log(
    "  node create-zips.js --start-batch N    # Start from specific batch (0-based)"
  );
  console.log(
    "\n💡 The script automatically saves progress and can resume if interrupted."
  );
}

// Check for help argument
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  showUsage();
  process.exit(0);
}

// Run the script
processAllUsers().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
