const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sharp = require("sharp");
const path = require("path");
const os = require("os");
const fs = require("fs");

admin.initializeApp();

/**
 * The Real-Time Optimizer (V1)
 * Triggers when a file is uploaded to the 'private_uploads/' folder.
 */
exports.realTimeOptimizer = functions.runWith({
    memory: "512MB",
    timeoutSeconds: 300
}).storage.object().onFinalize(async (object) => {
    const fileBucket = object.bucket;
    const filePath = object.name; // e.g. private_uploads/galleries/lion.jpg
    const contentType = object.contentType;

    // 1. Only process images uploaded to the 'private_uploads/' directory
    if (!filePath.startsWith("private_uploads/")) {
        return console.log("Skipping: Not in private_uploads/ folder.");
    }

    if (!contentType.startsWith("image/")) {
        return console.log("Skipping: Not an image.");
    }

    // 2. Define target path (Remove the 'private_uploads/' prefix)
    const targetPath = filePath.replace("private_uploads/", "");
    const bucket = admin.storage().bucket(fileBucket);
    
    // 3. Setup temporary local paths
    const fileName = path.basename(filePath);
    const tempFilePath = path.join(os.tmpdir(), fileName);
    const optimizedFilePath = path.join(os.tmpdir(), `optimized_${fileName}`);

    try {
        console.log(`🚀 Washing image (v1): ${filePath} -> ${targetPath}`);

        // A. Download original from private area
        await bucket.file(filePath).download({ destination: tempFilePath });

        // B. Process with Sharp
        await sharp(tempFilePath)
            .rotate()
            .resize({
                width: 2000,
                height: 2000,
                fit: "inside",
                withoutEnlargement: true
            })
            .jpeg({ quality: 90, progressive: true })
            .toFile(optimizedFilePath);

        // C. Upload "Clean" version to the public path
        // Using a random token for Firebase link stability
        const token = require('crypto').randomUUID();
        await bucket.upload(optimizedFilePath, {
            destination: targetPath,
            metadata: {
                contentType: "image/jpeg",
                metadata: {
                    firebaseStorageDownloadTokens: token
                }
            }
        });

        console.log(`✅ Clean image uploaded to: ${targetPath}`);

        // D. Cleanup: Delete the raw file
        await bucket.file(filePath).delete();
        console.log(`🗑️ Deleted unwashed file: ${filePath}`);

        // E. Cleanup local temp files
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
        if (fs.existsSync(optimizedFilePath)) fs.unlinkSync(optimizedFilePath);

    } catch (error) {
        console.error("❌ Optimization failed:", error);
    }
});

/**
 * Creates a new Administrator Account
 * Callable from the frontend dashboard.
 */
exports.createAdminAccount = functions.https.onCall(async (data, context) => {
    // 1. Verify caller is authenticated
    if (!context.auth || !context.auth.token.email) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerEmail = context.auth.token.email.toLowerCase();
    const newAdminEmail = (data.email || '').toLowerCase().trim();

    if (!newAdminEmail || !newAdminEmail.includes('@')) {
        throw new functions.https.HttpsError('invalid-argument', 'Valid email address is required.');
    }

    // 2. Verify caller is an authorized admin in Firestore
    const adminDoc = await admin.firestore().collection('admin_users').doc(callerEmail).get();
    if (!adminDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Only existing admins can create new admins.');
    }

    try {
        // 3. Check or Create the Firebase Auth User
        const crypto = require('crypto');
        const tempPassword = crypto.randomBytes(18).toString('base64') + 'Aa1!';
        let userRecord;
        let wasCreated = false;
        
        try {
            userRecord = await admin.auth().getUserByEmail(newAdminEmail);
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                userRecord = await admin.auth().createUser({
                    email: newAdminEmail,
                    password: tempPassword,
                    emailVerified: true
                });
                wasCreated = true;
            } else {
                throw err;
            }
        }

        // 4. Authorize them in Firestore
        await admin.firestore().collection('admin_users').doc(newAdminEmail).set({
            role: 'admin',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: callerEmail
        });

        return { 
            success: true, 
            message: `Admin access granted.`,
            wasCreated: wasCreated,
            tempPassword: tempPassword
        };

    } catch (error) {
        console.error("Error creating admin account:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Deletes a file from Firebase Storage (Admin SDK — bypasses security rules)
 * Callable from the admin dashboard.
 */
exports.deleteStorageFile = functions.https.onCall(async (data, context) => {
    // 1. Verify caller is authenticated
    if (!context.auth || !context.auth.token.email) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerEmail = context.auth.token.email.toLowerCase();

    // 2. Verify caller is an authorized admin
    const adminDoc = await admin.firestore().collection('admin_users').doc(callerEmail).get();
    if (!adminDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can delete storage files.');
    }

    const { filePath } = data;
    if (!filePath || typeof filePath !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'A valid filePath is required.');
    }

    // 3. Safety check: only allow deletion of known safe paths
    const allowedPrefixes = ['guide_profile/', 'safaris/', 'galleries/', 'home_carousel/', 'site_assets/'];
    const isAllowed = allowedPrefixes.some(prefix => filePath.startsWith(prefix));
    if (!isAllowed) {
        throw new functions.https.HttpsError('invalid-argument', `Deletion of path '${filePath}' is not permitted.`);
    }

    try {
        const bucket = admin.storage().bucket();
        await bucket.file(filePath).delete();
        console.log(`🗑️ Admin deleted storage file: ${filePath} (by ${callerEmail})`);
        return { success: true, deleted: filePath };
    } catch (error) {
        // If file doesn't exist, treat as success (idempotent)
        if (error.code === 404) {
            console.log(`File not found (already deleted?): ${filePath}`);
            return { success: true, deleted: filePath, note: 'File was already gone.' };
        }
        console.error('Error deleting storage file:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Deletes an Administrator Account
 * Callable from the frontend dashboard.
 */
exports.deleteAdminAccount = functions.https.onCall(async (data, context) => {
    // 1. Verify caller is authenticated
    if (!context.auth || !context.auth.token.email) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const callerEmail = context.auth.token.email.toLowerCase();
    const adminEmailToDelete = (data.email || '').toLowerCase().trim();

    if (!adminEmailToDelete || !adminEmailToDelete.includes('@')) {
        throw new functions.https.HttpsError('invalid-argument', 'Valid email address is required.');
    }

    if (callerEmail === adminEmailToDelete) {
        throw new functions.https.HttpsError('failed-precondition', 'You cannot delete your own admin account.');
    }

    // 2. Verify caller is an authorized admin in Firestore
    const adminDoc = await admin.firestore().collection('admin_users').doc(callerEmail).get();
    if (!adminDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Only existing admins can remove admins.');
    }

    try {
        const dbFs = admin.firestore();
        const adminRef = dbFs.collection('admin_users').doc(adminEmailToDelete);

        // 3. Run a transaction to verify count and delete the Firestore document
        await dbFs.runTransaction(async (transaction) => {
            const adminUsersColl = dbFs.collection('admin_users');
            const snap = await transaction.get(adminUsersColl);
            if (snap.size <= 1) {
                throw new Error('Action Denied: Cannot delete the last remaining administrator account.');
            }
            transaction.delete(adminRef);
        });

        // 4. Delete the Firebase Auth User
        try {
            const userRecord = await admin.auth().getUserByEmail(adminEmailToDelete);
            await admin.auth().deleteUser(userRecord.uid);
            console.log(`Successfully deleted auth user: ${userRecord.uid}`);
        } catch (err) {
            if (err.code === 'auth/user-not-found') {
                console.log("User not found in Auth, skipping Auth deletion.");
            } else {
                throw err;
            }
        }

        return { 
            success: true, 
            message: `Admin ${adminEmailToDelete} has been completely removed.`
        };

    } catch (error) {
        console.error("Error deleting admin account:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
// Force redeploy trigger comment
