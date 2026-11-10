const azureStorage = require('azure-storage');

const CONTAINER = 'ruidea';

const service = () => azureStorage.createBlobService();

// Uploads the zip buffer and returns the stored blob name. The blob name is keyed by
// the server-side record id (passed in), never by client input (§11.3).
const uploadZip = (blobName, buffer) =>
	new Promise((resolve, reject) => {
		const getStream = require('into-stream');
		const stream = getStream(buffer);
		service().createBlockBlobFromStream(CONTAINER, blobName, stream, buffer.length, error => {
			if (error) return reject(error);
			resolve(blobName);
		});
	});

// Short-lived read-only SAS URL for one blob. Replaces returning a public anonymous
// URL and depends on the container being PRIVATE (§3.2). Default 5-minute expiry.
const sasUrl = (blobName, minutes = 5) => {
	const blobService = service();
	const start = new Date(Date.now() - 5 * 60 * 1000); // small clock skew allowance
	const expiry = new Date(Date.now() + minutes * 60 * 1000);
	const sas = blobService.generateSharedAccessSignature(CONTAINER, blobName, {
		AccessPolicy: {
			Permissions: azureStorage.BlobUtilities.SharedAccessPermissions.READ,
			Start: start,
			Expiry: expiry,
		},
	});
	return blobService.getUrl(CONTAINER, blobName, sas);
};

// Deletes one blob and any snapshots of it. Resolves true if it was deleted, false if there
// was nothing to delete. Rejects on a storage error, so callers can log it.
const deleteBlob = blobName =>
	new Promise((resolve, reject) => {
		if (!blobName) return resolve(false);
		const options = { deleteSnapshots: azureStorage.BlobUtilities.SnapshotDeleteOptions.BLOB_AND_SNAPSHOTS };
		service().deleteBlobIfExists(CONTAINER, blobName, options, (error, deleted) =>
			error ? reject(error) : resolve(Boolean(deleted))
		);
	});

// Names of all blobs whose name starts with `prefix` (every page of the listing).
const listBlobs = async prefix => {
	const names = [];
	let token = null;
	do {
		const page = await new Promise((resolve, reject) =>
			service().listBlobsSegmentedWithPrefix(CONTAINER, prefix, token, (error, result) =>
				error ? reject(error) : resolve(result)
			)
		);
		for (const entry of page.entries) names.push(entry.name);
		token = page.continuationToken;
	} while (token);
	return names;
};

// A user's uploads are stored as "<record id>/<timestamp>.zip". The id must be a record id
// (24 lowercase hex), so the prefix can never be empty or reach into another user's folder.
const userPrefix = id => {
	if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) throw new Error('not a record id');
	return `${id}/`;
};

// Deletes every stored document of one user: all blobs under "<id>/" (the current zip and
// any earlier ones), plus `archivoBlob` if it is stored outside that folder (older naming).
// Never rejects. Returns { deleted, failed, error } so the caller can log and carry on.
const deleteUserDocuments = async (id, archivoBlob) => {
	const result = { deleted: 0, failed: 0, error: null };
	let names = [];
	try {
		names = await listBlobs(userPrefix(id));
	} catch (err) {
		result.failed++;
		result.error = err;
	}
	if (archivoBlob && !names.includes(archivoBlob)) names.push(archivoBlob);
	for (const name of names) {
		try {
			if (await deleteBlob(name)) result.deleted++;
		} catch (err) {
			result.failed++;
			result.error = err;
		}
	}
	return result;
};

// Logs a storage failure by its code only: storage errors can carry request details.
const logBlobError = (req, err, message, extra = {}) =>
	req.log && req.log.error({ ...extra, code: (err && (err.code || err.name)) || 'unknown', statusCode: err && err.statusCode }, message);

module.exports = { uploadZip, sasUrl, deleteBlob, listBlobs, deleteUserDocuments, logBlobError, CONTAINER };
