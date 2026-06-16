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

const deleteBlob = blobName =>
	new Promise(resolve => {
		if (!blobName) return resolve();
		service().deleteBlobIfExists(CONTAINER, blobName, () => resolve());
	});

module.exports = { uploadZip, sasUrl, deleteBlob, CONTAINER };
