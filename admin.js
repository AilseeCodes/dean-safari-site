import { app } from './firebase-init.js';
import {
    getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import {
    getFirestore, doc, getDoc as _getDoc, setDoc as _setDoc, collection, getDocs as _getDocs, deleteDoc as _deleteDoc, query, orderBy, onSnapshot as _onSnapshot, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-storage.js";
import {
    getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-functions.js";

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

/**
 * Shared helper: delete a file from Firebase Storage via the Admin SDK Cloud Function.
 * This bypasses client-side Storage security rules (which can silently fail when
 * firestore.exists() is evaluated mid-operation), ensuring reliable cleanup.
 * Accepts either a full Firebase download URL or a bare storage path.
 */
async function deleteStorageFileViaServer(urlOrPath) {
    if (!urlOrPath) return;
    try {
        let filePath = urlOrPath;
        // If it's a full HTTPS download URL, extract the storage path
        if (urlOrPath.startsWith('https://firebasestorage.googleapis.com/')) {
            const parts = urlOrPath.split('/o/');
            if (parts.length < 2) return;
            filePath = decodeURIComponent(parts[1].split('?')[0]);
        }
        const deleteStorageFileFn = httpsCallable(functions, 'deleteStorageFile');
        await deleteStorageFileFn({ filePath });
        console.log(`✅ Storage cleanup via server: ${filePath}`);
    } catch (e) {
        // Non-fatal: log but do not block the save operation
        console.warn('⚠️ Could not delete old storage file via server:', e);
    }
}

// === Real-Time Firestore Operation Tracker ===
let sessionReads = 0;
let sessionWrites = 0;

let todayReads = 0;
let todayWrites = 0;
let loadedDateStr = "";

let pendingReadsBuffer = 0;
let pendingWritesBuffer = 0;
let syncTimeout = null;

function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function trackFirestoreRead(count = 1) {
    sessionReads += count;
    pendingReadsBuffer += count;
    updateFirestoreQuotaUI();
    scheduleUsageSync();
}

function trackFirestoreWrite(count = 1) {
    sessionWrites += count;
    pendingWritesBuffer += count;
    updateFirestoreQuotaUI();
    scheduleUsageSync();
}

function scheduleUsageSync() {
    if (syncTimeout) return;
    syncTimeout = setTimeout(async () => {
        syncTimeout = null;
        await syncUsageToFirestore();
    }, 3000); // Debounce and sync every 3 seconds of activity
}

async function syncUsageToFirestore() {
    const readsToSync = pendingReadsBuffer;
    const writesToSync = pendingWritesBuffer;
    if (readsToSync === 0 && writesToSync === 0) return;

    // Clear the buffers before calling Firebase to prevent double-counting if overlapping
    pendingReadsBuffer -= readsToSync;
    pendingWritesBuffer -= writesToSync;

    const todayStr = getTodayDateString();
    const docRef = doc(db, "site_settings", "usage_tracking");

    try {
        const docSnap = await _getDoc(docRef);
        if (docSnap.exists() && docSnap.data().date === todayStr) {
            await _setDoc(docRef, {
                reads: increment(readsToSync),
                writes: increment(writesToSync)
            }, { merge: true });
        } else {
            await _setDoc(docRef, {
                date: todayStr,
                reads: readsToSync,
                writes: writesToSync
            }, { merge: true });
        }
    } catch (err) {
        console.error("Failed to sync daily usage to Firestore:", err);
        // Put back in buffer on failure
        pendingReadsBuffer += readsToSync;
        pendingWritesBuffer += writesToSync;
    }
}

window.refreshFirestoreUsageMetrics = async function () {
    const todayStr = getTodayDateString();

    if (pendingReadsBuffer > 0 || pendingWritesBuffer > 0) {
        await syncUsageToFirestore();
    }

    const docRef = doc(db, "site_settings", "usage_tracking");
    try {
        const docSnap = await _getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.date === todayStr) {
                todayReads = data.reads || 0;
                todayWrites = data.writes || 0;
            } else {
                todayReads = 0;
                todayWrites = 0;
            }
        } else {
            todayReads = 0;
            todayWrites = 0;
        }
        loadedDateStr = todayStr;
        updateFirestoreQuotaUI();
    } catch (err) {
        console.error("Failed to fetch daily usage metrics:", err);
    }
};

function updateFirestoreQuotaUI() {
    const qReadsVal = document.getElementById('q-reads-val');
    const qReadsBar = document.getElementById('q-reads-bar');
    const qReadsDesc = document.getElementById('q-reads-desc');

    const qWritesVal = document.getElementById('q-writes-val');
    const qWritesBar = document.getElementById('q-writes-bar');
    const qWritesDesc = document.getElementById('q-writes-desc');

    const displayReads = todayReads + pendingReadsBuffer;
    const displayWrites = todayWrites + pendingWritesBuffer;

    if (qReadsVal && qReadsBar && qReadsDesc) {
        qReadsVal.textContent = displayReads.toLocaleString();
        const percentReads = Math.min((displayReads / 50000) * 100, 100);
        qReadsBar.style.width = `${percentReads}%`;
        qReadsDesc.innerHTML = `<span>Today's Total Reads: ${displayReads.toLocaleString()}</span><span>Limit: 50,000 / day</span>`;

        const badge = document.getElementById('q-reads-status-badge');
        if (badge) {
            if (percentReads >= 95) {
                badge.className = "quota-badge critical";
                badge.textContent = "CRITICAL";
            } else if (percentReads >= 80) {
                badge.className = "quota-badge warning";
                badge.textContent = "WARNING";
            } else {
                badge.className = "quota-badge healthy";
                badge.textContent = "HEALTHY";
            }
        }
    }

    if (qWritesVal && qWritesBar && qWritesDesc) {
        qWritesVal.textContent = displayWrites.toLocaleString();
        const percentWrites = Math.min((displayWrites / 20000) * 100, 100);
        qWritesBar.style.width = `${percentWrites}%`;
        qWritesDesc.innerHTML = `<span>Today's Total Writes: ${displayWrites.toLocaleString()}</span><span>Limit: 20,000 / day</span>`;

        const badge = document.getElementById('q-writes-status-badge');
        if (badge) {
            if (percentWrites >= 95) {
                badge.className = "quota-badge critical";
                badge.textContent = "CRITICAL";
            } else if (percentWrites >= 80) {
                badge.className = "quota-badge warning";
                badge.textContent = "WARNING";
            } else {
                badge.className = "quota-badge healthy";
                badge.textContent = "HEALTHY";
            }
        }
    }
}

// Wrap imported Firestore functions to count operations transparently!
async function getDoc(reference) {
    trackFirestoreRead(1);
    return await _getDoc(reference);
}

async function getDocs(referenceOrQuery) {
    const snap = await _getDocs(referenceOrQuery);
    if (snap && snap.size !== undefined) {
        trackFirestoreRead(snap.size || 1);
    } else {
        trackFirestoreRead(1);
    }
    return snap;
}

async function setDoc(reference, data, options) {
    trackFirestoreWrite(1);
    if (options !== undefined) {
        return await _setDoc(reference, data, options);
    }
    return await _setDoc(reference, data);
}

async function deleteDoc(reference) {
    trackFirestoreWrite(1);
    return await _deleteDoc(reference);
}

function onSnapshot(referenceOrQuery, onNext, onError, onCompletion) {
    trackFirestoreRead(1);
    let wrappedCallback;
    if (typeof onNext === 'function') {
        wrappedCallback = function (snapshot) {
            if (snapshot && snapshot.size !== undefined) {
                trackFirestoreRead(snapshot.size);
            }
            onNext(snapshot);
        };
        return _onSnapshot(referenceOrQuery, wrappedCallback, onError, onCompletion);
    } else if (onNext && typeof onNext.next === 'function') {
        const originalNext = onNext.next;
        onNext.next = function (snapshot) {
            if (snapshot && snapshot.size !== undefined) {
                trackFirestoreRead(snapshot.size);
            }
            originalNext(snapshot);
        };
        return _onSnapshot(referenceOrQuery, onNext);
    } else {
        return _onSnapshot(referenceOrQuery, onNext, onError, onCompletion);
    }
}

// === DOM Elements ===
// Layout & Navigation
const loginScreen = document.getElementById('login-screen');
const adminLayout = document.getElementById('admin-layout');
const authError = document.getElementById('auth-error');
const emailForm = document.getElementById('email-login-form');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const navLinks = document.querySelectorAll('.nav-link');
const viewSections = document.querySelectorAll('.view-section');
const mobileToggle = document.getElementById('mobile-sidebar-toggle');
const sidebar = document.querySelector('.sidebar');

// Sidebar Bottom
const btnBackToSite = document.getElementById('btn-back-to-site');
const logoutBtn = document.getElementById('logout-btn');

// Site Settings
const settingsForm = document.getElementById('settings-form');
const setEmail = document.getElementById('set-email');
const setWa = document.getElementById('set-wa');
const setWaLink = document.getElementById('set-walink');
const setAddress = document.getElementById('set-address');

// Operations
const opsListContainer = document.getElementById('operations-list');
const opsListView = document.getElementById('ops-list-view');
const opsEditorView = document.getElementById('ops-editor-view');
const btnCreateNewOp = document.getElementById('btn-create-new');
const btnCancelOpEdit = document.getElementById('btn-cancel-edit');
const opForm = document.getElementById('operation-form');
const editorTitle = document.getElementById('editor-title');
// const opSectionsContainer = document.getElementById('op-sections-container'); // Removed
// const btnAddOpSection = document.getElementById('btn-add-section'); // Removed

// Gallery
const galleryListContainer = document.getElementById('gallery-collections-list');
const galleryListView = document.getElementById('gallery-list-view');
const galleryEditorView = document.getElementById('gallery-editor-view');
const btnCreateGallery = document.getElementById('btn-create-gallery');
const btnCancelGalleryEdit = document.getElementById('btn-cancel-gallery-edit');
const galleryForm = document.getElementById('gallery-form');
const galleryPhotoInput = document.getElementById('gallery-photo-input');
const galleryEditorTitle = document.getElementById('gallery-editor-title');
const galleryTitleInput = document.getElementById('gallery-title');

// Guide Profile
const guideProfileForm = document.getElementById('guide-profile-form');
const guideIntroTitleInput = document.getElementById('guide-intro-title');
const guideIntroInput = document.getElementById('guide-intro-input');
const guideFooterQuoteInput = document.getElementById('guide-footer-quote-input');
const guideProfessionInput = document.getElementById('guide-profession-input');
const guideLocationInput = document.getElementById('guide-location-input');
const guideExpertiseInput = document.getElementById('guide-expertise-input');
const guideFocusInput = document.getElementById('guide-focus-input');
const guideCareerInput = document.getElementById('guide-career-input');
const guideConservationInput = document.getElementById('guide-conservation-input');
const guideRecognitionInput = document.getElementById('guide-recognition-input');
// Guide Profile Image Inputs
const guideHeroInput = document.getElementById('guide-hero-input');
const guideImg0Input = document.getElementById('guide-img-0-input');
const guideImg1Input = document.getElementById('guide-img-1-input');
const guideImg2Input = document.getElementById('guide-img-2-input');

// Guide Profile Image Previews
const guideHeroPreview = document.getElementById('guide-hero-preview');
const guideImg0Preview = document.getElementById('guide-img-0-preview');
const guideImg1Preview = document.getElementById('guide-img-1-preview');
const guideImg2Preview = document.getElementById('guide-img-2-preview');

// Live Grid Editor
const liveGridEditor = document.getElementById('live-grid-editor');
const reorderStrip = document.getElementById('reorder-strip');
const uploadQueueContainer = document.getElementById('upload-queue-container');
const uploadQueueList = document.getElementById('upload-queue-list');
const previewDesktopBtn = document.getElementById('preview-desktop');
const previewMobileBtn = document.getElementById('preview-mobile');
const templateCards = document.querySelectorAll('.template-card');
const portalCanvas = document.getElementById('portal-canvas');
const btnSaveCanvas = document.getElementById('btn-save-canvas');

// Podcast Subtitles
const subtitleList = document.getElementById('subtitle-list');
const btnSaveSubtitles = document.getElementById('btn-save-subtitles');

// Modals
const returnSiteModal = document.getElementById('return-site-modal');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalConfirm = document.getElementById('btn-modal-confirm');
const deleteModal = document.getElementById('delete-modal');
const deleteConfirmInput = document.getElementById('delete-confirm-input');
const btnCancelDelete = document.getElementById('btn-cancel-delete');
const btnConfirmDelete = document.getElementById('btn-confirm-delete');

// Snackbar
const snackbar = document.getElementById('snackbar');
const snackbarText = document.getElementById('snackbar-text');
const btnUndo = document.getElementById('btn-undo');

// State
let operationsData = [];
let galleriesData = [];
let safarisData = { intro: '', parks: {}, extras: [] };
let pendingDeleteDoc = null;
let pendingDeleteData = null;
let pendingDeleteType = 'operation';
let undoTimeout = null;
let galleryPhotosToUpload = [];
let existingGalleryPhotos = []; // This will now store objects { url, focal: { x, y } }
let albumCoverUrl = '';
let heroImageUrl = '';
let heroImageObj = null;
let selectedPhotoIdx = null;
let currentTemplate = 't1';
let hasUnsavedChanges = false;
let pendingNavTarget = null;

// === Undo / Redo Manager (Generic Snapshots) ===
class UndoRedoManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 50;
        this.batchTimeout = null;
        this.lastActionType = null;
        this.isWorking = false;
        this.activeSection = 'section-admin-users'; // Default
    }

    // Set the section currently being edited
    setSection(sectionId) {
        if (this.activeSection !== sectionId) {
            this.activeSection = sectionId;
            this.undoStack = [];
            this.redoStack = [];
            this.updateButtons();
        }
    }

    // Capture a state change
    push(actionType, state, immediate = false) {
        if (this.isWorking) return;

        const performPush = () => {
            // Store the section along with the state
            this.undoStack.push({
                type: actionType,
                section: this.activeSection,
                state: JSON.parse(JSON.stringify(state))
            });
            if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
            this.redoStack = []; // Clear redo on new action
            this.updateButtons();
            this.lastActionType = actionType;
        };

        if (immediate) {
            clearTimeout(this.batchTimeout);
            performPush();
            hasUnsavedChanges = true;
        } else {
            // "Smart" batching for typing/nudging
            clearTimeout(this.batchTimeout);
            if (this.lastActionType === actionType) {
                this.batchTimeout = setTimeout(() => {
                    performPush();
                    hasUnsavedChanges = true;
                }, 800);
            } else {
                performPush();
                hasUnsavedChanges = true;
            }
        }
    }

    undo(currentStateCallback) {
        if (this.undoStack.length < 2) return; // Need at least current + previous
        this.isWorking = true;

        const current = this.undoStack.pop();
        this.redoStack.push(current);

        const prev = this.undoStack[this.undoStack.length - 1];
        this.applyState(prev.section, prev.state);

        // Callback to refresh UI after undo/redo
        if (prev.section === 'section-testimonials') updateTestimonialsUnsavedStatus(true);
        if (prev.section === 'section-home-carousel') updateCarouselUnsavedStatus(true);
        if (prev.section === 'section-gallery') updateGalleryUnsavedStatus(true);

        this.updateButtons();
        this.isWorking = false;
    }

    redo(currentStateCallback) {
        if (this.redoStack.length === 0) return;
        this.isWorking = true;

        const next = this.redoStack.pop();
        this.undoStack.push(next);

        this.applyState(next.section, next.state);

        // Callback to refresh UI after undo/redo
        if (next.section === 'section-testimonials') updateTestimonialsUnsavedStatus(true);
        if (next.section === 'section-home-carousel') updateCarouselUnsavedStatus(true);
        if (next.section === 'section-gallery') updateGalleryUnsavedStatus(true);

        this.updateButtons();
        this.isWorking = false;
    }

    applyState(sectionId, state) {
        this.isWorking = true;

        // Use the SectionStateManager to restore the state
        if (window.SectionStateManager && window.SectionStateManager[sectionId]) {
            window.SectionStateManager[sectionId].restore(state);
        } else {
            console.warn(`No restorer found for section: ${sectionId}`);
        }

        this.isWorking = false;
    }

    updateButtons() {
        const btnUndo = document.getElementById('btn-global-undo');
        const btnRedo = document.getElementById('btn-global-redo');
        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;

        // Custom buttons for Testimonials
        const btnTestUndo = document.getElementById('btn-testimonials-undo');
        const btnTestRedo = document.getElementById('btn-testimonials-redo');
        if (btnTestUndo) btnTestUndo.disabled = this.undoStack.length === 0;
        if (btnTestRedo) btnTestRedo.disabled = this.redoStack.length === 0;

        // Custom buttons for Gallery
        const btnGalUndo = document.getElementById('btn-gallery-undo');
        const btnGalRedo = document.getElementById('btn-gallery-redo');
        if (btnGalUndo) btnGalUndo.disabled = this.undoStack.length === 0;
        if (btnGalRedo) btnGalRedo.disabled = this.redoStack.length === 0;
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.updateButtons();
    }
}

const history = new UndoRedoManager();

// === Section State Manager ===
// This handles capturing and restoring the state of each dashboard section.
window.SectionStateManager = {
    'section-admin-users': {
        capture: () => ({}),
        restore: (state) => { }
    },
    'section-settings': {
        capture: () => ({
            email: document.getElementById('set-email').value,
            whatsapp: document.getElementById('set-wa').value,
            whatsappLink: document.getElementById('set-walink').value,
            address: document.getElementById('set-address')?.value || '',
            privacyPolicy: {
                minimizationTitle: document.getElementById('privacy-minimization-title').value,
                minimizationContent: document.getElementById('privacy-minimization-content').value,
                forgottenTitle: document.getElementById('privacy-forgotten-title').value,
                forgottenContent: document.getElementById('privacy-forgotten-content').value,
                cookieTitle: document.getElementById('privacy-cookie-title').value,
                cookieContent: document.getElementById('privacy-cookie-content').value,
                governingTitle: document.getElementById('privacy-governing-title').value,
                governingContent: document.getElementById('privacy-governing-content').value
            }
        }),
        restore: (state) => {
            document.getElementById('set-email').value = state.email || '';
            document.getElementById('set-wa').value = state.whatsapp || '';
            document.getElementById('set-walink').value = state.whatsappLink || '';
            if (document.getElementById('set-address')) {
                document.getElementById('set-address').value = state.address || '';
            }
            if (state.privacyPolicy) {
                const p = state.privacyPolicy;
                document.getElementById('privacy-minimization-title').value = p.minimizationTitle || '';
                document.getElementById('privacy-minimization-content').value = p.minimizationContent || '';
                document.getElementById('privacy-forgotten-title').value = p.forgottenTitle || '';
                document.getElementById('privacy-forgotten-content').value = p.forgottenContent || '';
                document.getElementById('privacy-cookie-title').value = p.cookieTitle || '';
                document.getElementById('privacy-cookie-content').value = p.cookieContent || '';
                document.getElementById('privacy-governing-title').value = p.governingTitle || '';
                document.getElementById('privacy-governing-content').value = p.governingContent || '';
            } else {
                document.getElementById('privacy-minimization-title').value = '';
                document.getElementById('privacy-minimization-content').value = '';
                document.getElementById('privacy-forgotten-title').value = '';
                document.getElementById('privacy-forgotten-content').value = '';
                document.getElementById('privacy-cookie-title').value = '';
                document.getElementById('privacy-cookie-content').value = '';
                document.getElementById('privacy-governing-title').value = '';
                document.getElementById('privacy-governing-content').value = '';
            }
        }
    },
    'section-operations': {
        capture: () => {
            // Synchronize DOM values into in-memory safarisData first
            // 1. Seasonal grid months
            const schematicBlocks = document.querySelectorAll('.seasonal-grid-editor');
            schematicBlocks.forEach(block => {
                const parkId = block.dataset.park;
                const inputs = block.querySelectorAll('.month-status-input');
                const months = Array.from(inputs).map(i => i.value);
                if (!safarisData.parks[parkId]) {
                    safarisData.parks[parkId] = { id: parkId };
                }
                safarisData.parks[parkId].months = months;
            });

            // 2. Park info fields
            const parkInfoBlocks = document.querySelectorAll('.park-info-block');
            parkInfoBlocks.forEach(block => {
                const titleInput = block.querySelector('.park-title-input');
                if (!titleInput) return;
                const parkId = titleInput.dataset.park;
                const description = block.querySelector('.park-description-input').value;
                const bullets = block.querySelector('.park-bullets-input').value;
                const url = block.querySelector('.park-url-input').value;
                if (!safarisData.parks[parkId]) {
                    safarisData.parks[parkId] = { id: parkId };
                }
                safarisData.parks[parkId].title = titleInput.value;
                safarisData.parks[parkId].description = description;
                safarisData.parks[parkId].bullets = bullets;
            });

            // 3. Park schematic toggles
            const toggles = document.querySelectorAll('.park-schematic-toggle');
            toggles.forEach(toggle => {
                const parkId = toggle.dataset.park;
                if (safarisData.parks[parkId]) {
                    safarisData.parks[parkId].show_seasonal_schematic = toggle.checked;
                }
            });

            return {
                panelTitle: document.getElementById('panel-title').value,
                panelDesc: document.getElementById('panel-desc').value,
                panelImageUrl: document.getElementById('panel-image-url').value,
                introText: document.getElementById('safari-intro-text').value,
                travelTitle: document.getElementById('travel-title').value,
                travelContent: document.getElementById('travel-content').value,
                safarisData: JSON.parse(JSON.stringify(safarisData))
            };
        },
        restore: (state) => {
            document.getElementById('panel-title').value = state.panelTitle || '';
            document.getElementById('panel-desc').value = state.panelDesc || '';
            document.getElementById('panel-image-url').value = state.panelImageUrl || '';
            const preview = document.getElementById('panel-image-preview');
            if (state.panelImageUrl) {
                preview.innerHTML = `<img src="${state.panelImageUrl}" style="width:100%; height:100%; object-fit:cover;">`;
            } else {
                preview.innerHTML = `<span style="opacity: 0.4;">No image uploaded</span>`;
            }
            document.getElementById('safari-intro-text').value = state.introText || '';
            document.getElementById('travel-title').value = state.travelTitle || '';
            document.getElementById('travel-content').value = state.travelContent || '';
            if (state.safarisData) {
                safarisData = JSON.parse(JSON.stringify(state.safarisData));
                renderSchematicEditors();
                renderParkInfoEditors();
            }

            // Compare restored state with the LAST SAVED state to determine if it's still "unsaved"
            const savedState = savedSectionStates['section-operations'];
            const isDirty = JSON.stringify(safarisData) !== JSON.stringify(savedState ? savedState.safarisData : {});
            updateOperationsUnsavedStatus(isDirty);
        }
    },
    'section-gallery': {
        capture: () => ({
            data: JSON.parse(JSON.stringify(galleriesData)),
            view: galleryEditorView.style.display === 'block' ? 'editor' : 'list',
            editor: galleryEditorView.style.display === 'block' ? {
                id: document.getElementById('gallery-id').value,
                title: galleryTitleInput.value,
                photos: JSON.parse(JSON.stringify(existingGalleryPhotos)),
                cover: albumCoverUrl,
                hero: heroImageUrl,
                heroObj: heroImageObj ? JSON.parse(JSON.stringify(heroImageObj)) : null,
                template: currentTemplate
            } : null
        }),
        restore: (state) => {
            galleriesData = JSON.parse(JSON.stringify(state.data));
            renderGalleriesList();
            if (state.view === 'editor' && state.editor) {
                document.getElementById('gallery-id').value = state.editor.id;
                galleryTitleInput.value = state.editor.title;
                existingGalleryPhotos = JSON.parse(JSON.stringify(state.editor.photos));
                albumCoverUrl = state.editor.cover;
                heroImageUrl = state.editor.hero || '';
                heroImageObj = state.editor.heroObj ? JSON.parse(JSON.stringify(state.editor.heroObj)) : null;
                currentTemplate = state.editor.template;
                updateTemplateUI();
                renderLiveGrid();
                galleryListView.style.display = 'none';
                galleryEditorView.style.display = 'block';
            } else {
                galleryEditorView.style.display = 'none';
                galleryListView.style.display = 'block';
            }
        }
    },
    'section-guide': {
        capture: () => {
            const facts = [];
            document.querySelectorAll('.key-fact-row').forEach(row => {
                facts.push({ label: row.querySelector('.fact-label').value, value: row.querySelector('.fact-value').value });
            });
            const customSections = [];
            document.querySelectorAll('.custom-bio-group').forEach(group => {
                customSections.push({ title: group.querySelector('.custom-title').value, text: group.querySelector('.custom-text').value });
            });
            return {
                intro: document.getElementById('guide-intro-input').value,
                footer_quote: document.getElementById('guide-footer-quote-input').value,
                facts: facts,
                careerTitle: document.getElementById('guide-career-title').value,
                careerText: document.getElementById('guide-career-input').value,
                consTitle: document.getElementById('guide-conservation-title').value,
                consText: document.getElementById('guide-conservation-input').value,
                recTitle: document.getElementById('guide-recognition-title').value,
                recText: document.getElementById('guide-recognition-input').value,
                customSections: customSections
            };
        },
        restore: (state) => {
            document.getElementById('guide-intro-input').value = state.intro || "";
            if (document.getElementById('guide-footer-quote-input')) {
                document.getElementById('guide-footer-quote-input').value = state.footer_quote || "";
            }
            const factsContainer = document.getElementById('dynamic-key-facts');
            factsContainer.innerHTML = '';
            state.facts.forEach(f => createKeyFactUI(f.label, f.value));
            document.getElementById('guide-career-title').value = state.careerTitle || "";
            document.getElementById('guide-career-input').value = state.careerText || "";
            document.getElementById('guide-conservation-title').value = state.consTitle || "";
            document.getElementById('guide-conservation-input').value = state.consText || "";
            document.getElementById('guide-recognition-title').value = state.recTitle || "";
            document.getElementById('guide-recognition-input').value = state.recText || "";
            const customContainer = document.getElementById('custom-bio-sections');
            customContainer.innerHTML = '';
            state.customSections.forEach(s => createCustomSectionUI(s.title, s.text));
        }
    },
    'section-portal-canvas': {
        capture: () => ({ config: JSON.parse(JSON.stringify(portalConfig)) }),
        restore: (state) => {
            portalConfig = JSON.parse(JSON.stringify(state.config));
            renderPortalCanvas();
        }
    },
    'section-podcast': {
        capture: () => ({
            lines: Array.from(subtitleList.querySelectorAll('.subtitle-row')).map(row => ({
                start: row.querySelector('.sub-start').value,
                end: row.querySelector('.sub-end').value,
                text: row.querySelector('.sub-text').value
            }))
        }),
        restore: (state) => {
            subtitleList.innerHTML = '';
            state.lines.forEach(l => window.addSubtitleLine(l.start, l.end, l.text));
        }
    },
    'section-testimonials': {
        capture: () => {
            const data = [];
            document.querySelectorAll('#testimonials-list .glass-card').forEach(card => {
                data.push({
                    name: card.querySelector('.test-name').value,
                    location: card.querySelector('.test-location').value,
                    photo: card.querySelector('.test-photo').value,
                    text: card.querySelector('.test-text').value,
                    focal: {
                        x: card.querySelector('.focal-x').value,
                        y: card.querySelector('.focal-y').value
                    },
                    scale: parseFloat(card.querySelector('.test-scale').value) || 1.0
                });
            });
            return { list: data };
        },
        restore: (state) => {
            const testimonialsList = document.getElementById('testimonials-list');
            testimonialsList.innerHTML = '';
            state.list.forEach(item => window.addTestimonial(item));
        }
    },
    'section-home-carousel': {
        capture: () => ({ images: JSON.parse(JSON.stringify(homeCarouselImages)) }),
        restore: (state) => {
            homeCarouselImages = JSON.parse(JSON.stringify(state.images));
            renderCarouselManager();
            // Compare restored state with the LAST SAVED state to determine if it's still "unsaved"
            const savedState = savedSectionStates['section-home-carousel'];
            const isDirty = JSON.stringify(homeCarouselImages) !== JSON.stringify(savedState ? savedState.images : []);
            updateCarouselUnsavedStatus(isDirty);
        }
    }
};

let savedSectionStates = {}; // Snapshots taken when entering or saving a section

// === Initialization ===
onAuthStateChanged(auth, async (user) => {
    if (user) {
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
                return e.returnValue;
            }
        });
        loginScreen.style.display = 'none';
        adminLayout.style.display = 'grid';

        // Dynamically configure GoatCounter links and iframe based on hosting domain
        let goatcounterCode = 'deansafaris';
        if (window.location.hostname.includes('deanmcgregorsafaris') || window.location.hostname.includes('mcgregorsafaris')) {
            goatcounterCode = 'deanmcgregorsafaris';
        } else if (window.location.hostname.includes('deantest-abc')) {
            goatcounterCode = 'deantest-abc';
        } else if (window.location.hostname.includes('deanstesthandover')) {
            goatcounterCode = 'deanstesthandover';
        }
        const goatcounterLink = document.querySelector('a[href*="goatcounter.com"]');
        if (goatcounterLink) {
            goatcounterLink.href = `https://${goatcounterCode}.goatcounter.com`;
        }
        const goatcounterIframe = document.getElementById('iframe-goatcounter');
        if (goatcounterIframe) {
            goatcounterIframe.src = `https://${goatcounterCode}.goatcounter.com`;
        }

        await initializeDashboard();
    } else {
        loginScreen.style.display = 'flex';
        adminLayout.style.display = 'none';
    }
});

// === Global Input Tracking for Unsaved Changes ===
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.addEventListener('input', (e) => {
            if (e.target.id === 'delete-confirm-input') return;
            if (e.target.id === 'whisper-input') return;

            const section = history.activeSection;
            if (section === 'section-admin-users') return; // Ignore Admin Manager tab completely

            if (window.SectionStateManager[section]) {
                hasUnsavedChanges = true;
                history.push(`${section}_edit`, window.SectionStateManager[section].capture());
            }
        });

        mainContent.addEventListener('change', (e) => {
            if (e.target.id === 'delete-confirm-input') return;

            const section = history.activeSection;
            if (section === 'section-admin-users') return; // Ignore Admin Manager tab completely

            if (window.SectionStateManager[section]) {
                hasUnsavedChanges = true;
                history.push(`${section}_change`, window.SectionStateManager[section].capture(), true);
            }
        });

        // === Ctrl+I / Cmd+I Footnote Formatting Shortcut ===
        // Wraps selected text in <small><em>...</em></small> tags for fine-print footnotes
        mainContent.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
                const target = e.target;
                if (target.tagName !== 'TEXTAREA' && target.tagName !== 'INPUT') return;

                e.preventDefault();
                e.stopPropagation();

                const start = target.selectionStart;
                const end = target.selectionEnd;
                const value = target.value;
                const selectedText = value.substring(start, end);

                const openTag = '<small style="font-size: 0.85em; opacity: 0.85;"><em>';
                const closeTag = '</em></small>';

                const replacement = openTag + selectedText + closeTag;
                target.value = value.substring(0, start) + replacement + value.substring(end);

                // Place cursor after the inserted tags (or inside if no selection)
                const cursorPos = selectedText.length > 0
                    ? start + replacement.length
                    : start + openTag.length;
                target.setSelectionRange(cursorPos, cursorPos);

                // Trigger input event so the unsaved changes tracker picks it up
                target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
});

// Global Dashboard Loader
async function initializeDashboard() {
    await loadSettings();
    saveSectionSnapshot('section-settings');

    await loadOperations();
    saveSectionSnapshot('section-operations');

    await loadGalleries();
    saveSectionSnapshot('section-gallery');

    await loadPortalConfig();
    saveSectionSnapshot('section-portal-canvas');

    await loadSubtitles();
    saveSectionSnapshot('section-podcast');

    await loadTestimonials();
    saveSectionSnapshot('section-testimonials');

    await initGuideProfileManager();
    saveSectionSnapshot('section-guide');

    await loadHomeCarousel();
    saveSectionSnapshot('section-home-carousel');

    // Load authorized administrators list immediately so the default active tab renders successfully on first paint
    await loadAdminUsers();
    saveSectionSnapshot('section-admin-users');

    // Load platform daily usage metrics initially
    await window.refreshFirestoreUsageMetrics();
    // Run initial live Storage and Quotas scan
    await updateLiveQuotaMetrics(true);

    // Perform background storage cleanup for 14-day old deleted collections
    performStorageCleanup().catch(err => console.error("Error during background storage cleanup:", err));
}

function saveSectionSnapshot(sectionId) {
    if (window.SectionStateManager[sectionId]) {
        savedSectionStates[sectionId] = window.SectionStateManager[sectionId].capture();
    }
}

// === Home Carousel Manager ===
let homeCarouselImages = [];
let carouselUploadQueue = [];
let activeFocalIndex = null;
const carouselUploadInput = document.getElementById('carousel-upload-input');
const btnSaveCarouselOrder = document.getElementById('btn-save-carousel-order');
const carouselUnsavedBadge = document.getElementById('carousel-unsaved-badge');

function updateCarouselUnsavedStatus(status) {
    hasUnsavedChanges = status;
    if (carouselUnsavedBadge) {
        carouselUnsavedBadge.style.display = status ? 'inline-block' : 'none';
    }
}

let pristineHomeCarouselImages = [];
async function loadHomeCarousel() {
    const carouselManagerGrid = document.getElementById('carousel-manager-grid');
    if (!carouselManagerGrid) return;

    try {
        const docSnap = await getDoc(doc(db, "site_config", "home_carousel"));
        if (docSnap.exists()) {
            homeCarouselImages = docSnap.data().images || [];
            pristineHomeCarouselImages = JSON.parse(JSON.stringify(homeCarouselImages));
        } else {
            // Fallback to defaults
            homeCarouselImages = [
                { url: "assets/images/gallery-campfire.jpg", alt: "Bush Campfire", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-giraffe.jpg", alt: "Conservation Work", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-rhino-baby.jpg", alt: "Rhino and Baby", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-hippo.jpg", alt: "Hippo Yawning", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-truck-1.jpg", alt: "Safari Truck", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-vic-falls.jpg", alt: "Victoria Falls", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-lions-bush.jpg", alt: "Lions in the Wild", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-butterfly.jpg", alt: "Safari Butterfly", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-kudu.jpg", alt: "Kudu Antelope", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-rhino-touch.jpg", alt: "Rhino Connection", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-lake.jpg", alt: "Safari Landscape", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-chameleon.png", alt: "Chameleon", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-walking-bush.jpg", alt: "Guided Bush Walk", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-elephant-reflection.jpg", alt: "Elephant Reflection", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-zebra.jpg", alt: "Zebra Resting", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-hornbill.jpg", alt: "Yellow-billed Hornbill", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-lion-truck.jpg", alt: "Lion Encounter", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-millipede.jpg", alt: "Giant Millipede", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-flame-lily.jpg", alt: "Flame Lily", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-snake.jpg", alt: "Tracking Wildlife", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-blue-bird.jpg", alt: "Greater Blue-eared Starling", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-group.jpg", alt: "Safari Group", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-tortoise-shoes.jpg", alt: "Small Encounter", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-elephant-water.jpg", alt: "Elephant Crossing", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-rhinos-bush.jpg", alt: "Rhinos in the Bush", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-bug.jpg", alt: "Jewel Beetle", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-water-bird.jpg", alt: "Wildlife by the River", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-truck-2.jpg", alt: "Safari Experience", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-lourie.jpg", alt: "Grey Lourie", focal: { x: 50, y: 50 } },
                { url: "assets/images/gallery-tortoise.jpg", alt: "Wild Tortoise", focal: { x: 50, y: 50 } }
            ];
        }
        renderCarouselManager();
        updateCarouselUnsavedStatus(false);

        // Push initial state to history
        const state = window.SectionStateManager['section-home-carousel'].capture();
        history.undoStack = [{ type: 'initial', section: 'section-home-carousel', state: JSON.parse(JSON.stringify(state)) }];
        history.updateButtons();
    } catch (e) {
        console.error("Error loading carousel:", e);
    }
}

function renderCarouselManager() {
    const carouselManagerGrid = document.getElementById('carousel-manager-grid');
    if (!carouselManagerGrid) return;
    carouselManagerGrid.innerHTML = '';

    homeCarouselImages.forEach((img, index) => {
        const div = document.createElement('div');
        div.className = 'carousel-admin-item';
        div.setAttribute('data-index', index);
        div.style = "position: relative; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1); cursor: grab; transition: transform 0.2s, box-shadow 0.2s;";

        // Use focal point for the thumbnail preview too
        const focal = img.focal || { x: 50, y: 50 };

        div.innerHTML = `
            <div style="width: 100%; aspect-ratio: 1/1; overflow: hidden; background: #000;">
                <img src="${img.url}" style="width: 100%; height: 100%; object-fit: cover; object-position: ${focal.x}% ${focal.y}%;">
            </div>
            <div style="padding: 0.8rem; font-size: 0.75rem; color: #444; font-weight: 500; display: flex; justify-content: space-between; align-items: center;">
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${img.alt || 'Untitled'}</span>
                <span style="opacity: 0.4; font-size: 0.65rem;">#${index + 1}</span>
            </div>
            <div class="item-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.4); opacity: 0; transition: opacity 0.2s; display: flex; align-items: center; justify-content: center; gap: 1rem; pointer-events: none;">
                <i class="fas fa-arrows-alt" style="color: white; font-size: 1.5rem;"></i>
            </div>
            <button type="button" onclick="deleteCarouselImage(${index}, true)" style="position: absolute; top: 8px; right: 8px; background: #ff4757; color: white; border: none; border-radius: 50%; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 5;">
                <i class="fas fa-trash" style="font-size: 0.8rem;"></i>
            </button>
        `;

        // Double click to edit focal point
        div.ondblclick = () => openFocalEditor(index);

        // Hover effect for DnD hint
        div.onmouseenter = () => div.querySelector('.item-overlay').style.opacity = '1';
        div.onmouseleave = () => div.querySelector('.item-overlay').style.opacity = '0';

        carouselManagerGrid.appendChild(div);
    });

    // Initialize Sortable
    if (window.Sortable) {
        new Sortable(carouselManagerGrid, {
            animation: 250,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: () => {
                const newOrder = [];
                carouselManagerGrid.querySelectorAll('.carousel-admin-item').forEach(el => {
                    const idx = parseInt(el.getAttribute('data-index'));
                    newOrder.push(homeCarouselImages[idx]);
                });

                // Compare to see if actually changed
                if (JSON.stringify(newOrder) !== JSON.stringify(homeCarouselImages)) {
                    history.push('carousel_reorder', window.SectionStateManager['section-home-carousel'].capture(), true);
                    homeCarouselImages = newOrder;
                    updateCarouselUnsavedStatus(true);
                    renderCarouselManager();
                }
            }
        });
    }
}

window.deleteCarouselImage = (index, pushToHistory = true) => {
    if (pushToHistory) {
        history.push('carousel_delete', window.SectionStateManager['section-home-carousel'].capture(), true);
    }
    homeCarouselImages.splice(index, 1);
    updateCarouselUnsavedStatus(true);
    renderCarouselManager();
    showSnackbar("Image removed from carousel.");
};

// --- Focal Point Editor ---
const focalModal = document.getElementById('carousel-focal-modal');
const focalEditorImg = document.getElementById('focal-editor-img');
const focalEditorContainer = document.getElementById('focal-editor-container');
const btnSaveFocal = document.getElementById('btn-save-focal');
const btnResetFocal = document.getElementById('btn-reset-focal');
const btnCloseFocal = document.getElementById('btn-close-focal-modal');

let isDraggingFocal = false;
let dragStartX, dragStartY;
let startFocalX, startFocalY;

function openFocalEditor(index) {
    activeFocalIndex = index;
    const img = homeCarouselImages[index];
    focalEditorImg.src = img.url;

    const focal = img.focal || { x: 50, y: 50 };

    focalModal.classList.add('active');

    focalEditorImg.onload = () => updateFocalUI(focal.x, focal.y);

    showSnackbar("Click and drag the image to adjust framing.");
}

function updateFocalUI(x, y) {
    const containerW = focalEditorContainer.offsetWidth;
    const containerH = focalEditorContainer.offsetHeight;

    const imgW = focalEditorImg.naturalWidth;
    const imgH = focalEditorImg.naturalHeight;

    // Scale image to cover the 1:1 container
    let scale = 1;
    if (imgW / imgH > 1) { // Landscape
        scale = containerH / imgH;
    } else { // Portrait or Square
        scale = containerW / imgW;
    }

    const displayW = imgW * scale;
    const displayH = imgH * scale;

    focalEditorImg.style.width = `${displayW}px`;
    focalEditorImg.style.height = `${displayH}px`;

    // Calculate position based on focal percentage
    // focal 0% means left/top edge aligned to container edge
    // focal 100% means right/bottom edge aligned to container edge
    const maxScrollX = displayW - containerW;
    const maxScrollY = displayH - containerH;

    const left = -maxScrollX * (x / 100);
    const top = -maxScrollY * (y / 100);

    focalEditorImg.style.left = `${left}px`;
    focalEditorImg.style.top = `${top}px`;
}

// Drag Logic
if (focalEditorContainer) {
    focalEditorContainer.addEventListener('mousedown', (e) => {
        if (activeFocalIndex === null) return;
        isDraggingFocal = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const img = homeCarouselImages[activeFocalIndex];
        startFocalX = img.focal ? img.focal.x : 50;
        startFocalY = img.focal ? img.focal.y : 50;
        focalEditorContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingFocal) return;

        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        const containerW = focalEditorContainer.offsetWidth;
        const containerH = focalEditorContainer.offsetHeight;
        const imgW = focalEditorImg.naturalWidth;
        const imgH = focalEditorImg.naturalHeight;

        let scale = 1;
        if (imgW / imgH > 1) scale = containerH / imgH;
        else scale = containerW / imgW;

        const displayW = imgW * scale;
        const displayH = imgH * scale;

        const maxScrollX = displayW - containerW;
        const maxScrollY = displayH - containerH;

        const img = homeCarouselImages[activeFocalIndex];
        if (!img.focal) img.focal = { x: 50, y: 50 };

        if (maxScrollX > 0) {
            const pctChangeX = (dx / maxScrollX) * 100;
            img.focal.x = Math.max(0, Math.min(100, startFocalX - pctChangeX));
        }
        if (maxScrollY > 0) {
            const pctChangeY = (dy / maxScrollY) * 100;
            img.focal.y = Math.max(0, Math.min(100, startFocalY - pctChangeY));
        }

        updateFocalUI(img.focal.x, img.focal.y);
    });

    window.addEventListener('mouseup', () => {
        isDraggingFocal = false;
        if (focalEditorContainer) focalEditorContainer.style.cursor = 'move';
    });
}

function nudgeFocal(dx, dy) {
    if (activeFocalIndex === null) return;
    const img = homeCarouselImages[activeFocalIndex];
    if (!img.focal) img.focal = { x: 50, y: 50 };

    img.focal.x = Math.max(0, Math.min(100, img.focal.x + dx));
    img.focal.y = Math.max(0, Math.min(100, img.focal.y + dy));

    updateFocalUI(img.focal.x, img.focal.y);
}

if (btnSaveFocal) {
    btnSaveFocal.onclick = () => {
        history.push('carousel_focal', window.SectionStateManager['section-home-carousel'].capture(), true);
        updateCarouselUnsavedStatus(true);
        renderCarouselManager();
        focalModal.classList.remove('active');
        activeFocalIndex = null;
    };
}

if (btnResetFocal) {
    btnResetFocal.onclick = () => {
        if (activeFocalIndex === null) return;
        homeCarouselImages[activeFocalIndex].focal = { x: 50, y: 50 };
        updateFocalUI(50, 50);
    };
}

if (btnCloseFocal) {
    btnCloseFocal.onclick = () => {
        focalModal.classList.remove('active');
        activeFocalIndex = null;
        renderCarouselManager(); // Re-render to clear unsaved nudge if they canceled (though nudge is live)
    };
}

// --- Gallery Photo Focal Point Editor ---
let activeGalleryFocalIndex = null;
let isDraggingGalleryFocal = false;
let galleryDragStartX, galleryDragStartY;
let galleryStartFocalX, galleryStartFocalY;

// --- Collection Hero Photo Focal Point Editor ---
let activeHeroFocalIndex = null;
let isDraggingHeroFocal = false;
let heroDragStartX, heroDragStartY;
let heroStartFocalX, heroStartFocalY;

window.openGalleryFocalEditor = function (index) {
    activeGalleryFocalIndex = index;
    const photo = existingGalleryPhotos[index];
    if (!photo) return;

    const modal = document.getElementById('gallery-focal-modal');
    const editorImg = document.getElementById('gallery-focal-editor-img');
    const container = document.getElementById('gallery-focal-editor-container');

    editorImg.src = photo.url;

    // Aspect ratio selection matching grid layout (Wide, Tall, or Square)
    let type = 'normal';

    if (currentTemplate === 't1') {
        const patternIndex = index % 4;
        if (patternIndex === 0) type = 'big';
        else if (patternIndex === 1) type = 'wide';
    } else if (currentTemplate === 't2') {
        if (index % 2 === 0) type = 'wide';
    } else if (currentTemplate === 't3') {
        if (index % 4 === 0) type = 'wide';
    } else if (currentTemplate === 't4') {
        if (index % 3 === 2) type = 'tall';
    }

    if (type === 'wide') {
        container.style.width = '500px';
        container.style.height = '250px';
    } else if (type === 'tall') {
        container.style.width = '333px';
        container.style.height = '500px';
    } else {
        container.style.width = '500px';
        container.style.height = '500px';
    }

    const focal = photo.focal || { x: 50, y: 50 };
    modal.classList.add('active');

    editorImg.onload = () => updateGalleryFocalUI(focal.x, focal.y);
    showSnackbar("Click and drag the image to adjust framing.");
};

function updateGalleryFocalUI(x, y) {
    const editorImg = document.getElementById('gallery-focal-editor-img');
    const container = document.getElementById('gallery-focal-editor-container');
    if (!editorImg || !container) return;

    const containerW = container.offsetWidth;
    const containerH = container.offsetHeight;

    const imgW = editorImg.naturalWidth;
    const imgH = editorImg.naturalHeight;

    let scale = 1;
    if (imgW / imgH > containerW / containerH) {
        scale = containerH / imgH;
    } else {
        scale = containerW / imgW;
    }

    const displayW = imgW * scale;
    const displayH = imgH * scale;

    editorImg.style.width = `${displayW}px`;
    editorImg.style.height = `${displayH}px`;

    const maxScrollX = displayW - containerW;
    const maxScrollY = displayH - containerH;

    const left = -maxScrollX * (x / 100);
    const top = -maxScrollY * (y / 100);

    editorImg.style.left = `${left}px`;
    editorImg.style.top = `${top}px`;
}

// Drag Logic for Gallery Focal Editor
const galleryFocalContainer = document.getElementById('gallery-focal-editor-container');
if (galleryFocalContainer) {
    galleryFocalContainer.addEventListener('mousedown', (e) => {
        if (activeGalleryFocalIndex === null) return;
        isDraggingGalleryFocal = true;
        galleryDragStartX = e.clientX;
        galleryDragStartY = e.clientY;
        const photo = existingGalleryPhotos[activeGalleryFocalIndex];
        galleryStartFocalX = photo.focal ? photo.focal.x : 50;
        galleryStartFocalY = photo.focal ? photo.focal.y : 50;
        galleryFocalContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingGalleryFocal || activeGalleryFocalIndex === null) return;

        const dx = e.clientX - galleryDragStartX;
        const dy = e.clientY - galleryDragStartY;

        const container = document.getElementById('gallery-focal-editor-container');
        const editorImg = document.getElementById('gallery-focal-editor-img');

        const containerW = container.offsetWidth;
        const containerH = container.offsetHeight;
        const imgW = editorImg.naturalWidth;
        const imgH = editorImg.naturalHeight;

        let scale = 1;
        if (imgW / imgH > containerW / containerH) scale = containerH / imgH;
        else scale = containerW / imgW;

        const displayW = imgW * scale;
        const displayH = imgH * scale;

        const maxScrollX = displayW - containerW;
        const maxScrollY = displayH - containerH;

        const photo = existingGalleryPhotos[activeGalleryFocalIndex];
        if (!photo.focal) photo.focal = { x: 50, y: 50 };

        if (maxScrollX > 0) {
            const pctChangeX = (dx / maxScrollX) * 100;
            photo.focal.x = Math.max(0, Math.min(100, galleryStartFocalX - pctChangeX));
        }
        if (maxScrollY > 0) {
            const pctChangeY = (dy / maxScrollY) * 100;
            photo.focal.y = Math.max(0, Math.min(100, galleryStartFocalY - pctChangeY));
        }

        updateGalleryFocalUI(photo.focal.x, photo.focal.y);
    });

    window.addEventListener('mouseup', () => {
        isDraggingGalleryFocal = false;
        if (galleryFocalContainer) galleryFocalContainer.style.cursor = 'move';
    });
}

function nudgeGalleryFocal(dx, dy) {
    if (activeGalleryFocalIndex === null) return;
    const photo = existingGalleryPhotos[activeGalleryFocalIndex];
    if (!photo.focal) photo.focal = { x: 50, y: 50 };

    photo.focal.x = Math.max(0, Math.min(100, photo.focal.x + dx));
    photo.focal.y = Math.max(0, Math.min(100, photo.focal.y + dy));

    updateGalleryFocalUI(photo.focal.x, photo.focal.y);
}

const btnSaveGalleryFocal = document.getElementById('btn-save-gallery-focal');
const btnResetGalleryFocal = document.getElementById('btn-reset-gallery-focal');
const btnCloseGalleryFocal = document.getElementById('btn-close-gallery-focal-modal');

if (btnSaveGalleryFocal) {
    btnSaveGalleryFocal.onclick = () => {
        renderLiveGrid();
        updateGalleryUnsavedStatus(true);
        history.push('gallery_focal_adjust', window.SectionStateManager['section-gallery'].capture(), true);
        document.getElementById('gallery-focal-modal').classList.remove('active');
        activeGalleryFocalIndex = null;
    };
}

if (btnResetGalleryFocal) {
    btnResetGalleryFocal.onclick = () => {
        if (activeGalleryFocalIndex === null) return;
        existingGalleryPhotos[activeGalleryFocalIndex].focal = { x: 50, y: 50 };
        updateGalleryFocalUI(50, 50);
    };
}

if (btnCloseGalleryFocal) {
    btnCloseGalleryFocal.onclick = () => {
        document.getElementById('gallery-focal-modal').classList.remove('active');
        activeGalleryFocalIndex = null;
        renderLiveGrid();
    };
}

// --- Collection Hero Photo Focal Point Editor Functions ---
window.openHeroFocalEditor = function (index) {
    activeHeroFocalIndex = index;
    const photo = existingGalleryPhotos[index];
    if (!photo) return;

    const modal = document.getElementById('hero-focal-modal');
    const editorImg = document.getElementById('hero-focal-editor-img');
    const container = document.getElementById('hero-focal-editor-container');

    editorImg.src = photo.url;

    // We use a fixed 800x300 width/height aspect ratio for the hero focal container
    container.style.width = '800px';
    container.style.height = '300px';

    // If heroImageObj exists and its URL matches this photo, load its focal coordinates. Otherwise default to {x: 50, y: 50}
    let focal = { x: 50, y: 50 };
    if (heroImageObj && heroImageObj.url === photo.url) {
        focal = heroImageObj.focal || { x: 50, y: 50 };
    }

    modal.classList.add('active');

    editorImg.onload = () => updateHeroFocalUI(focal.x, focal.y);
    showSnackbar("Click and drag the image to adjust the collection hero banner position.");
};

function updateHeroFocalUI(x, y) {
    const editorImg = document.getElementById('hero-focal-editor-img');
    const container = document.getElementById('hero-focal-editor-container');
    if (!editorImg || !container) return;

    const containerW = container.offsetWidth;
    const containerH = container.offsetHeight;

    const imgW = editorImg.naturalWidth;
    const imgH = editorImg.naturalHeight;

    let scale = 1;
    if (imgW / imgH > containerW / containerH) {
        scale = containerH / imgH;
    } else {
        scale = containerW / imgW;
    }

    const displayW = imgW * scale;
    const displayH = imgH * scale;

    editorImg.style.width = `${displayW}px`;
    editorImg.style.height = `${displayH}px`;

    const maxScrollX = displayW - containerW;
    const maxScrollY = displayH - containerH;

    const left = -maxScrollX * (x / 100);
    const top = -maxScrollY * (y / 100);

    editorImg.style.left = `${left}px`;
    editorImg.style.top = `${top}px`;
}

// Drag Logic for Hero Focal Editor
const heroFocalContainer = document.getElementById('hero-focal-editor-container');
if (heroFocalContainer) {
    heroFocalContainer.addEventListener('mousedown', (e) => {
        if (activeHeroFocalIndex === null) return;
        isDraggingHeroFocal = true;
        heroDragStartX = e.clientX;
        heroDragStartY = e.clientY;

        let focal = { x: 50, y: 50 };
        if (heroImageObj && heroImageObj.url === existingGalleryPhotos[activeHeroFocalIndex].url) {
            focal = heroImageObj.focal || { x: 50, y: 50 };
        }
        heroStartFocalX = focal.x;
        heroStartFocalY = focal.y;
        heroFocalContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingHeroFocal || activeHeroFocalIndex === null) return;

        const dx = e.clientX - heroDragStartX;
        const dy = e.clientY - heroDragStartY;

        const container = document.getElementById('hero-focal-editor-container');
        const editorImg = document.getElementById('hero-focal-editor-img');

        const containerW = container.offsetWidth;
        const containerH = container.offsetHeight;
        const imgW = editorImg.naturalWidth;
        const imgH = editorImg.naturalHeight;

        let scale = 1;
        if (imgW / imgH > containerW / containerH) scale = containerH / imgH;
        else scale = containerW / imgW;

        const displayW = imgW * scale;
        const displayH = imgH * scale;

        const maxScrollX = displayW - containerW;
        const maxScrollY = displayH - containerH;

        if (!heroImageObj) {
            heroImageObj = { url: existingGalleryPhotos[activeHeroFocalIndex].url, focal: { x: 50, y: 50 } };
        } else if (heroImageObj.url !== existingGalleryPhotos[activeHeroFocalIndex].url) {
            heroImageObj = { url: existingGalleryPhotos[activeHeroFocalIndex].url, focal: { x: 50, y: 50 } };
        }

        if (maxScrollX > 0) {
            const pctChangeX = (dx / maxScrollX) * 100;
            heroImageObj.focal.x = Math.max(0, Math.min(100, heroStartFocalX - pctChangeX));
        }
        if (maxScrollY > 0) {
            const pctChangeY = (dy / maxScrollY) * 100;
            heroImageObj.focal.y = Math.max(0, Math.min(100, heroStartFocalY - pctChangeY));
        }

        updateHeroFocalUI(heroImageObj.focal.x, heroImageObj.focal.y);
    });

    window.addEventListener('mouseup', () => {
        isDraggingHeroFocal = false;
        if (heroFocalContainer) heroFocalContainer.style.cursor = 'move';
    });
}

function nudgeHeroFocal(dx, dy) {
    if (activeHeroFocalIndex === null) return;
    const photo = existingGalleryPhotos[activeHeroFocalIndex];
    if (!heroImageObj || heroImageObj.url !== photo.url) {
        heroImageObj = { url: photo.url, focal: { x: 50, y: 50 } };
    }

    heroImageObj.focal.x = Math.max(0, Math.min(100, heroImageObj.focal.x + dx));
    heroImageObj.focal.y = Math.max(0, Math.min(100, heroImageObj.focal.y + dy));

    updateHeroFocalUI(heroImageObj.focal.x, heroImageObj.focal.y);
}

const btnSaveHeroFocal = document.getElementById('btn-save-hero-focal');
const btnResetHeroFocal = document.getElementById('btn-reset-hero-focal');
const btnCloseHeroFocal = document.getElementById('btn-close-hero-focal-modal');

if (btnSaveHeroFocal) {
    btnSaveHeroFocal.onclick = () => {
        renderLiveGrid();
        updateGalleryUnsavedStatus(true);
        history.push('hero_focal_adjust', window.SectionStateManager['section-gallery'].capture(), true);
        document.getElementById('hero-focal-modal').classList.remove('active');
        activeHeroFocalIndex = null;
    };
}

if (btnResetHeroFocal) {
    btnResetHeroFocal.onclick = () => {
        if (activeHeroFocalIndex === null) return;
        const photo = existingGalleryPhotos[activeHeroFocalIndex];
        heroImageObj = { url: photo.url, focal: { x: 50, y: 50 } };
        updateHeroFocalUI(50, 50);
    };
}

if (btnCloseHeroFocal) {
    btnCloseHeroFocal.onclick = () => {
        document.getElementById('hero-focal-modal').classList.remove('active');
        activeHeroFocalIndex = null;
        renderLiveGrid();
    };
}

// --- Portal Cover Photo Focal Point Editor ---
const portalFocalModal = document.getElementById('portal-focal-modal');
const portalFocalEditorImg = document.getElementById('portal-focal-editor-img');
const portalFocalEditorContainer = document.getElementById('portal-focal-editor-container');
const btnSavePortalFocal = document.getElementById('btn-save-portal-focal');
const btnResetPortalFocal = document.getElementById('btn-reset-portal-focal');
const btnClosePortalFocal = document.getElementById('btn-close-portal-focal-modal');

let activePortalFocalGalleryId = null;
let isDraggingPortalFocal = false;
let portalFocalDragStartX, portalFocalDragStartY;
let portalFocalStartFocalX, portalFocalStartFocalY;

window.openPortalFocalEditor = function (id) {
    activePortalFocalGalleryId = id;
    const g = galleriesData.find(item => item.id === id);
    if (!g) return;

    // Get the cover image
    let coverUrl = '';
    let coverObj = null;
    if (g.albumCover) {
        coverObj = g.albumCover;
        coverUrl = typeof g.albumCover === 'object' ? g.albumCover.url : g.albumCover;
    } else if (g.photos && g.photos.length > 0) {
        coverObj = g.photos[0];
        coverUrl = typeof coverObj === 'object' ? coverObj.url : coverObj;
    }

    if (!coverUrl) {
        showSnackbar("This collection has no photos or cover image to adjust.");
        return;
    }

    portalFocalEditorImg.src = coverUrl;

    // Dynamically size container to match the card aspect ratio and dimensions!
    const layout = portalConfig.layout[id] || { w: 250, h: 180 };
    const maxContainerW = 750;
    const maxContainerH = 480;

    let containerW = layout.w;
    let containerH = layout.h;

    const layoutAspect = layout.w / layout.h;
    const maxAspect = maxContainerW / maxContainerH;

    if (layoutAspect > maxAspect) {
        containerW = maxContainerW;
        containerH = maxContainerW / layoutAspect;
    } else {
        containerH = maxContainerH;
        containerW = maxContainerH * layoutAspect;
    }

    portalFocalEditorContainer.style.width = `${containerW}px`;
    portalFocalEditorContainer.style.height = `${containerH}px`;

    let focal = { x: 50, y: 50 };
    if (layout.focal) {
        focal = { x: layout.focal.x, y: layout.focal.y };
    } else if (coverObj && typeof coverObj === 'object' && coverObj.focal) {
        focal = { x: coverObj.focal.x, y: coverObj.focal.y };
    }

    portalFocalEditorImg.dataset.tempFocalX = focal.x;
    portalFocalEditorImg.dataset.tempFocalY = focal.y;

    portalFocalModal.classList.add('active');

    portalFocalEditorImg.onload = () => {
        updatePortalFocalUI(focal.x, focal.y);
    };

    showSnackbar("Drag the photo or use Arrow Keys (Shift+Arrows) to adjust crop framing inside the card.");
};

function updatePortalFocalUI(x, y) {
    if (!portalFocalEditorContainer || !portalFocalEditorImg) return;
    const containerW = portalFocalEditorContainer.offsetWidth;
    const containerH = portalFocalEditorContainer.offsetHeight;

    const imgW = portalFocalEditorImg.naturalWidth;
    const imgH = portalFocalEditorImg.naturalHeight;
    if (!imgW || !imgH) return;

    const containerAspect = containerW / containerH;
    const imgAspect = imgW / imgH;

    let scale = 1;
    if (imgAspect > containerAspect) {
        scale = containerH / imgH;
    } else {
        scale = containerW / imgW;
    }

    const displayW = imgW * scale;
    const displayH = imgH * scale;

    portalFocalEditorImg.style.width = `${displayW}px`;
    portalFocalEditorImg.style.height = `${displayH}px`;

    const maxScrollX = displayW - containerW;
    const maxScrollY = displayH - containerH;

    const left = -maxScrollX * (x / 100);
    const top = -maxScrollY * (y / 100);

    portalFocalEditorImg.style.left = `${left}px`;
    portalFocalEditorImg.style.top = `${top}px`;
}

if (portalFocalEditorContainer) {
    portalFocalEditorContainer.addEventListener('mousedown', (e) => {
        if (activePortalFocalGalleryId === null) return;
        isDraggingPortalFocal = true;
        portalFocalDragStartX = e.clientX;
        portalFocalDragStartY = e.clientY;

        portalFocalStartFocalX = parseFloat(portalFocalEditorImg.dataset.tempFocalX) || 50;
        portalFocalStartFocalY = parseFloat(portalFocalEditorImg.dataset.tempFocalY) || 50;

        portalFocalEditorContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingPortalFocal || activePortalFocalGalleryId === null) return;

        const dx = e.clientX - portalFocalDragStartX;
        const dy = e.clientY - portalFocalDragStartY;

        const containerW = portalFocalEditorContainer.offsetWidth;
        const containerH = portalFocalEditorContainer.offsetHeight;
        const imgW = portalFocalEditorImg.naturalWidth;
        const imgH = portalFocalEditorImg.naturalHeight;

        const containerAspect = containerW / containerH;
        const imgAspect = imgW / imgH;

        let scale = 1;
        if (imgAspect > containerAspect) {
            scale = containerH / imgH;
        } else {
            scale = containerW / imgW;
        }

        const displayW = imgW * scale;
        const displayH = imgH * scale;

        const maxScrollX = displayW - containerW;
        const maxScrollY = displayH - containerH;

        let newX = portalFocalStartFocalX;
        let newY = portalFocalStartFocalY;

        if (maxScrollX > 0) {
            const pctChangeX = (dx / maxScrollX) * 100;
            newX = Math.max(0, Math.min(100, portalFocalStartFocalX - pctChangeX));
        }
        if (maxScrollY > 0) {
            const pctChangeY = (dy / maxScrollY) * 100;
            newY = Math.max(0, Math.min(100, portalFocalStartFocalY - pctChangeY));
        }

        portalFocalEditorImg.dataset.tempFocalX = newX;
        portalFocalEditorImg.dataset.tempFocalY = newY;

        updatePortalFocalUI(newX, newY);
    });

    window.addEventListener('mouseup', () => {
        if (isDraggingPortalFocal) {
            isDraggingPortalFocal = false;
            if (portalFocalEditorContainer) portalFocalEditorContainer.style.cursor = 'move';
        }
    });
}

function nudgePortalFocal(dx, dy) {
    if (activePortalFocalGalleryId === null) return;

    let curX = parseFloat(portalFocalEditorImg.dataset.tempFocalX) || 50;
    let curY = parseFloat(portalFocalEditorImg.dataset.tempFocalY) || 50;

    let newX = Math.max(0, Math.min(100, curX + dx));
    let newY = Math.max(0, Math.min(100, curY + dy));

    portalFocalEditorImg.dataset.tempFocalX = newX;
    portalFocalEditorImg.dataset.tempFocalY = newY;

    updatePortalFocalUI(newX, newY);
}

if (btnSavePortalFocal) {
    btnSavePortalFocal.onclick = () => {
        if (activePortalFocalGalleryId === null) return;

        const layout = portalConfig.layout[activePortalFocalGalleryId];
        if (layout) {
            const tempX = parseFloat(portalFocalEditorImg.dataset.tempFocalX) || 50;
            const tempY = parseFloat(portalFocalEditorImg.dataset.tempFocalY) || 50;

            layout.focal = { x: tempX, y: tempY };

            hasUnsavedChanges = true;
            history.push('portal_cover_focal', window.SectionStateManager['section-portal-canvas'].capture(), true);

            renderPortalCanvas();
        }

        portalFocalModal.classList.remove('active');
        activePortalFocalGalleryId = null;
    };
}

if (btnResetPortalFocal) {
    btnResetPortalFocal.onclick = () => {
        if (activePortalFocalGalleryId === null) return;
        portalFocalEditorImg.dataset.tempFocalX = 50;
        portalFocalEditorImg.dataset.tempFocalY = 50;
        updatePortalFocalUI(50, 50);
    };
}

if (btnClosePortalFocal) {
    btnClosePortalFocal.onclick = () => {
        portalFocalModal.classList.remove('active');
        activePortalFocalGalleryId = null;
    };
}

// --- Upload Queue Logic ---
const carouselUploadQueueList = document.getElementById('carousel-upload-queue-list');
const carouselUploadQueueContainer = document.getElementById('carousel-upload-queue');

if (carouselUploadInput) {
    carouselUploadInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        files.forEach(file => {
            // Check file type
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                showSnackbar(`File type ${file.type} not supported.`);
                return;
            }
            carouselUploadQueue.push({ file, id: Math.random().toString(36).substr(2, 9), status: 'pending' });
        });

        renderCarouselUploadQueue();
        carouselUploadQueueContainer.style.display = 'block';
        carouselUploadInput.value = ''; // Reset input
    });
}

function renderCarouselUploadQueue() {
    if (!carouselUploadQueueList) return;
    carouselUploadQueueList.innerHTML = '';

    if (carouselUploadQueue.length === 0) {
        carouselUploadQueueContainer.style.display = 'none';
        return;
    }

    carouselUploadQueue.forEach((item, index) => {
        const div = document.createElement('div');
        div.style = "display: flex; justify-content: space-between; align-items: center; background: white; padding: 0.8rem 1.2rem; border-radius: 8px; border: 1px solid #ddd; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";

        const info = document.createElement('div');
        info.innerHTML = `<strong>${item.file.name}</strong> <span style="opacity: 0.5; font-size: 0.7rem; margin-left: 0.5rem;">${(item.file.size / 1024).toFixed(1)} KB</span>`;

        const actions = document.createElement('div');
        actions.style = "display: flex; gap: 0.5rem;";

        if (item.status === 'pending') {
            actions.innerHTML = `
                <button onclick="confirmUploadItem('${item.id}')" class="btn-primary" style="padding: 0.4rem 1rem; font-size: 0.75rem; background: #2ed573;">Confirm Upload</button>
                <button onclick="removeUploadItem('${item.id}')" class="btn-secondary" style="padding: 0.4rem 1rem; font-size: 0.75rem;">Cancel</button>
            `;
        } else if (item.status === 'uploading') {
            actions.innerHTML = `<span style="font-size: 0.8rem; color: var(--accent-gold);"><i class="fas fa-spinner fa-spin"></i> Processing...</span>`;
        } else if (item.status === 'done') {
            actions.innerHTML = `<span style="font-size: 0.8rem; color: #2ed573;"><i class="fas fa-check-circle"></i> Added</span>`;
        }

        div.appendChild(info);
        div.appendChild(actions);
        carouselUploadQueueList.appendChild(div);
    });
}

window.removeUploadItem = (id) => {
    carouselUploadQueue = carouselUploadQueue.filter(item => item.id !== id);
    renderCarouselUploadQueue();
};

window.confirmUploadItem = async (id) => {
    const item = carouselUploadQueue.find(i => i.id === id);
    if (!item) return;

    item.status = 'uploading';
    renderCarouselUploadQueue();

    try {
        // Wash and compress (strip metadata, convert to JPEG)
        const washedFile = await washImage(item.file, 2500);
        const storageRef = ref(storage, `home_carousel/${Date.now()}_${item.file.name}`);
        const snapshot = await uploadBytes(storageRef, washedFile);
        const url = await getDownloadURL(snapshot.ref);

        history.push('carousel_upload', window.SectionStateManager['section-home-carousel'].capture(), true);
        homeCarouselImages.unshift({ url, alt: item.file.name.split('.')[0], focal: { x: 50, y: 50 } });

        item.status = 'done';
        updateCarouselUnsavedStatus(true);
        renderCarouselManager();
        updateLiveQuotaMetrics(true); // Recalculate Storage immediately!

        // Remove from queue after a short delay
        setTimeout(() => {
            removeUploadItem(id);
        }, 1500);

    } catch (err) {
        console.error("Upload error:", err);
        item.status = 'pending';
        showSnackbar("Upload failed: " + err.message);
        renderCarouselUploadQueue();
    }
};

// --- Top Buttons Logic ---
const btnCarouselUndo = document.getElementById('btn-carousel-undo');
const btnCarouselRedo = document.getElementById('btn-carousel-redo');

if (btnCarouselUndo) {
    btnCarouselUndo.onclick = () => {
        history.undo(() => window.SectionStateManager['section-home-carousel'].capture());
        updateCarouselUnsavedStatus(true); // Any undo means changes compared to original save
    };
}

if (btnCarouselRedo) {
    btnCarouselRedo.onclick = () => {
        history.redo(() => window.SectionStateManager['section-home-carousel'].capture());
        updateCarouselUnsavedStatus(true);
    };
}

// Named global so both the top and bottom Save buttons share identical logic
window.saveCarouselChanges = async function () {
    const btnTop = document.getElementById('btn-save-carousel-order');
    const btnBottom = document.getElementById('btn-save-carousel-bottom');

    let deletedPhotos = [];
    if (pristineHomeCarouselImages.length > 0) {
        deletedPhotos = pristineHomeCarouselImages.filter(orig => {
            const origUrl = orig.url || orig;
            if (origUrl.startsWith('assets/')) return false;
            return !homeCarouselImages.some(curr => (curr.url || curr) === origUrl);
        });
    }

    if (deletedPhotos.length > 0) {
        if (!confirm(`Warning: Saving these changes will permanently delete ${deletedPhotos.length} removed carousel photos. This cannot be undone. Proceed?`)) {
            return;
        }
        showSnackbar("Cleaning up deleted photos...", false);
        for (const photo of deletedPhotos) {
            const url = photo.url || photo;
            await deleteStorageFileViaServer(url);
        }
    }

    // Disable + show spinner on whichever buttons exist
    const savingHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    const originalTopText = btnTop ? btnTop.innerHTML : '';
    const originalBottomText = btnBottom ? btnBottom.innerHTML : '';
    if (btnTop) { btnTop.disabled = true; btnTop.innerHTML = savingHTML; }
    if (btnBottom) { btnBottom.disabled = true; btnBottom.innerHTML = savingHTML; }

    try {
        await setDoc(doc(db, "site_config", "home_carousel"), {
            images: homeCarouselImages,
            lastUpdated: serverTimestamp()
        });
        updateCarouselUnsavedStatus(false);
        pristineHomeCarouselImages = JSON.parse(JSON.stringify(homeCarouselImages));
        saveSectionSnapshot('section-home-carousel');
        history.clear();
        updateLiveQuotaMetrics(true); // Recalculate Storage immediately!
        showSnackbar("Carousel changes live on website!");
    } catch (error) {
        console.error("Error saving carousel:", error);
        showSnackbar("Error saving carousel: " + error.message);
    } finally {
        if (btnTop) { btnTop.disabled = false; btnTop.innerHTML = originalTopText; }
        if (btnBottom) { btnBottom.disabled = false; btnBottom.innerHTML = originalBottomText; }
    }
};

if (btnSaveCarouselOrder) {
    btnSaveCarouselOrder.addEventListener('click', () => window.saveCarouselChanges());
}

// Keydown for Focal Editor
document.addEventListener('keydown', (e) => {
    if (activePortalFocalGalleryId !== null) {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') { nudgePortalFocal(0, -step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { nudgePortalFocal(0, step); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { nudgePortalFocal(-step, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight') { nudgePortalFocal(step, 0); e.preventDefault(); }
        if (e.key === 'Escape') {
            btnClosePortalFocal.click();
            e.preventDefault();
        }
        if (e.key === 'Enter') {
            btnSavePortalFocal.click();
            e.preventDefault();
        }
        return;
    }

    if (activeFocalIndex !== null) {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') { nudgeFocal(0, -step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { nudgeFocal(0, step); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { nudgeFocal(-step, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight') { nudgeFocal(step, 0); e.preventDefault(); }
        if (e.key === 'Escape') btnCloseFocal.click();
        if (e.key === 'Enter') btnSaveFocal.click();
        return;
    }

    if (activeHeroFocalIndex !== null) {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') { nudgeHeroFocal(0, -step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { nudgeHeroFocal(0, step); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { nudgeHeroFocal(-step, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight') { nudgeHeroFocal(step, 0); e.preventDefault(); }
        if (e.key === 'Escape') {
            const btnClose = document.getElementById('btn-close-hero-focal-modal');
            if (btnClose) btnClose.click();
            e.preventDefault();
        }
        if (e.key === 'Enter') {
            const btnSave = document.getElementById('btn-save-hero-focal');
            if (btnSave) btnSave.click();
            e.preventDefault();
        }
        return;
    }

    if (activeGalleryFocalIndex !== null) {
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') { nudgeGalleryFocal(0, -step); e.preventDefault(); }
        if (e.key === 'ArrowDown') { nudgeGalleryFocal(0, step); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { nudgeGalleryFocal(-step, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight') { nudgeGalleryFocal(step, 0); e.preventDefault(); }
        if (e.key === 'Escape') {
            const btnClose = document.getElementById('btn-close-gallery-focal-modal');
            if (btnClose) btnClose.click();
            e.preventDefault();
        }
        if (e.key === 'Enter') {
            const btnSave = document.getElementById('btn-save-gallery-focal');
            if (btnSave) btnSave.click();
            e.preventDefault();
        }
        return;
    }

    // Global Undo/Redo Shortcuts
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
            if (history.activeSection === 'section-home-carousel') {
                btnCarouselUndo.click();
                e.preventDefault();
            }
        }
        if (e.key === 'y') {
            if (history.activeSection === 'section-home-carousel') {
                btnCarouselRedo.click();
                e.preventDefault();
            }
        }
    }
});

// === Testimonials Manager ===

window.addTestimonial = (data = { name: '', location: '', text: '', photo: 'https://i.pravatar.cc/150', focal: { x: 50, y: 50 }, scale: 1.0 }, pushToHistory = false) => {
    const testimonialsList = document.getElementById('testimonials-list');
    if (!testimonialsList) return;
    const div = document.createElement('div');
    div.className = 'glass-card';
    div.style = "padding: 1.5rem; position: relative; background: #fff; border: 1px solid #eee;";

    const id = 'test-' + Math.random().toString(36).substr(2, 9);
    const focal = data.focal || { x: 50, y: 50 };

    const scale = data.scale || 1.0;

    div.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid #f0f0f0; padding-bottom: 0.5rem;">
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                <div class="test-drag-handle" style="cursor: grab; color: #ccc; margin-right: 5px;"><i class="fas fa-bars"></i></div>
                <i class="fas fa-quote-left" style="color: var(--accent-gold); opacity: 0.5;"></i>
                <span style="font-size: 0.8rem; font-weight: 600; color: #888;">Testimonial Card</span>
            </div>
            <div style="display: flex; gap: 0.8rem; align-items: center;">
                <div style="display: flex; gap: 0.3rem; margin-right: 0.5rem;">
                    <button type="button" class="card-undo-btn" title="Undo change in this section" style="background: none; border: none; color: #aaa; cursor: pointer; font-size: 0.8rem;"><i class="fas fa-undo"></i></button>
                    <button type="button" class="card-redo-btn" title="Redo change in this section" style="background: none; border: none; color: #aaa; cursor: pointer; font-size: 0.8rem;"><i class="fas fa-redo"></i></button>
                </div>
                <button type="button" class="remove-testimonial-btn" style="color: #ff6b6b; border: none; background: none; cursor: pointer; font-size: 1.1rem; padding: 0 5px;">&times;</button>
            </div>
        </div>
        
        <div style="display: flex; gap: 1.5rem; margin-bottom: 1rem;">
            <div style="flex-shrink: 0;">
                <div class="bubble-preview" 
                     onclick="selectTestimonialPhoto('${id}')"
                     style="width: 80px; height: 80px; border-radius: 50%; overflow: hidden; border: 3px solid var(--accent-gold); background: #eee; position: relative; cursor: pointer; transition: all 0.3s ease;">
                    <img src="${data.photo}" style="width: 100%; height: 100%; object-fit: cover; object-position: ${focal.x}% ${focal.y}%; transform: scale(${scale}); transform-origin: center;" id="preview-${id}">
                </div>
            </div>
            
            <div style="flex-grow: 1; display: flex; flex-direction: column; gap: 8px;">
                <label style="font-size: 0.7rem; font-weight: bold; text-transform: uppercase; color: #888;">Guest Photo</label>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="file" accept="image/*" onchange="handleTestimonialPhoto(this, '${id}')" style="font-size: 0.75rem; flex-grow: 1;">
                </div>
                <input type="hidden" class="test-photo" value="${data.photo}">
                <input type="hidden" class="test-scale" value="${scale}">
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 5px;">
                    <div>
                        <label style="font-size: 0.6rem; opacity: 0.7; display: block; margin-bottom: 2px;">Shift H</label>
                        <input type="range" class="focal-x" min="0" max="100" value="${focal.x}" oninput="updateBubbleFocal('${id}')" style="width: 100%;">
                    </div>
                    <div>
                        <label style="font-size: 0.6rem; opacity: 0.7; display: block; margin-bottom: 2px;">Shift V</label>
                        <input type="range" class="focal-y" min="0" max="100" value="${focal.y}" oninput="updateBubbleFocal('${id}')" style="width: 100%;">
                    </div>
                </div>
            </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.7rem; color: #888; font-weight: 700;">GUEST NAME</label>
                <input type="text" class="test-name" placeholder="Guest Name" value="${data.name || ''}" style="font-weight: 600; border: 1px solid #ddd; padding: 0.7rem; border-radius: 6px; width: 100%;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.7rem; color: #888; font-weight: 700;">LOCATION / TRIP DATE</label>
                <input type="text" class="test-location" placeholder="e.g. Hwange National Park - May 2024" value="${data.location || ''}" style="border: 1px solid #ddd; padding: 0.7rem; border-radius: 6px; width: 100%;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label style="font-size: 0.7rem; color: #888; font-weight: 700;">REVIEW TEXT</label>
                <textarea class="test-text" placeholder="Write the guest review here..." style="height: 120px; border: 1px solid #ddd; padding: 0.8rem; border-radius: 6px; font-size: 0.95rem; width: 100%; line-height: 1.5;">${data.text || ''}</textarea>
            </div>
        </div>
    `;

    // Internal History Support for inputs
    const inputs = div.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            history.push('testimonial_edit', window.SectionStateManager['section-testimonials'].capture(), false);
            updateTestimonialsUnsavedStatus(true);
        });
    });

    div.querySelector('.card-undo-btn').onclick = () => history.undo();
    div.querySelector('.card-redo-btn').onclick = () => history.redo();

    div.querySelector('.remove-testimonial-btn').onclick = () => {
        pendingDeleteType = 'testimonial';
        pendingDeleteData = { element: div, section: 'section-testimonials' };
        confirmDeletion("Are you sure you want to delete this testimonial? This will remove the entire guest card.");
    };
    testimonialsList.appendChild(div);

    if (pushToHistory) {
        updateTestimonialsUnsavedStatus(true);
        history.push('testimonial_add', window.SectionStateManager['section-testimonials'].capture(), true);
    }
};

window.updateTestimonialsUnsavedStatus = (isDirty) => {
    hasUnsavedChanges = isDirty;
    const badge = document.getElementById('testimonials-unsaved-badge');
    if (badge) badge.style.display = isDirty ? 'inline-block' : 'none';

    // Update history buttons (requires 2 states to undo)
    const undoBtn = document.getElementById('btn-testimonials-undo');
    const redoBtn = document.getElementById('btn-testimonials-redo');
    if (undoBtn) undoBtn.disabled = history.undoStack.length < 2;
    if (redoBtn) redoBtn.disabled = history.redoStack.length === 0;
};

window.handleTestimonialPhoto = async (input, id) => {
    const file = input.files[0];
    if (!file) return;

    // Wash and resize to 400px (Testimonial bubbles are small)
    const washedFile = await washImage(file, 400, 0.8);
    const reader = new FileReader();
    reader.onload = (e) => {
        const resizedUrl = e.target.result;
        document.getElementById(`preview-${id}`).src = resizedUrl;
        const card = document.getElementById(`preview-${id}`).closest('.glass-card');
        card.querySelector('.test-photo').value = resizedUrl;
    };
    reader.readAsDataURL(washedFile);
};

window.updateBubbleFocal = (id) => {
    const img = document.getElementById(`preview-${id}`);
    const card = img.closest('.glass-card');
    const x = card.querySelector('.focal-x').value;
    const y = card.querySelector('.focal-y').value;
    img.style.objectPosition = `${x}% ${y}%`;
};

window.saveTestimonials = async () => {
    const btn = document.getElementById('btn-save-testimonials');
    const testimonialsList = document.getElementById('testimonials-list');
    if (!testimonialsList) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    const cards = testimonialsList.querySelectorAll('.glass-card');
    const data = [];
    cards.forEach(card => {
        data.push({
            name: card.querySelector('.test-name').value,
            location: card.querySelector('.test-location').value,
            photo: card.querySelector('.test-photo').value,
            text: card.querySelector('.test-text').value,
            focal: {
                x: card.querySelector('.focal-x').value,
                y: card.querySelector('.focal-y').value
            },
            scale: parseFloat(card.querySelector('.test-scale').value) || 1.0
        });
    });
    try {
        await setDoc(doc(db, "site_config", "testimonials"), { list: data });
        updateTestimonialsUnsavedStatus(false);
        saveSectionSnapshot('section-testimonials');
        history.clear();
        showSnackbar("Testimonials & Framing Saved!");
    } catch (e) {
        alert("Error saving.");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = 'Save Changes';
        }
    }
};

async function loadTestimonials() {
    const testimonialsList = document.getElementById('testimonials-list');
    if (!testimonialsList) return;
    testimonialsList.innerHTML = '';
    const docSnap = await getDoc(doc(db, "site_config", "testimonials"));
    if (docSnap.exists()) {
        const list = docSnap.data().list || [];
        list.forEach(item => window.addTestimonial(item));
        saveSectionSnapshot('section-testimonials');
        updateTestimonialsUnsavedStatus(false);

        // Push initial state to history so undo works from the start
        const state = window.SectionStateManager['section-testimonials'].capture();
        history.undoStack = [{ type: 'initial', section: 'section-testimonials', state: JSON.parse(JSON.stringify(state)) }];
        history.updateButtons();
    }

    // Connect Undo/Redo
    const undoBtn = document.getElementById('btn-testimonials-undo');
    const redoBtn = document.getElementById('btn-testimonials-redo');
    if (undoBtn) undoBtn.onclick = () => history.undo();
    if (redoBtn) redoBtn.onclick = () => history.redo();

    // Initialize Drag & Drop for Testimonials
    if (window.Sortable) {
        if (window.testimonialSortable) window.testimonialSortable.destroy();
        window.testimonialSortable = new Sortable(testimonialsList, {
            animation: 150,
            handle: '.test-drag-handle',
            ghostClass: 'sortable-ghost',
            onEnd: () => {
                history.push('testimonial_reorder', window.SectionStateManager['section-testimonials'].capture(), true);
                updateTestimonialsUnsavedStatus(true);
            }
        });
    }
}

// === Auth Logic ===
if (emailForm) {
    emailForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = emailForm.querySelector('button');
        btn.disabled = true;
        try {
            await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
        } catch (error) {
            authError.textContent = "Invalid credentials.";
            authError.style.display = 'block';
        } finally {
            btn.disabled = false;
        }
    });
}

let pendingNavAction = null; // 'logout', 'home', or null (for tab links)

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (hasUnsavedChanges) {
            pendingNavAction = 'logout';
            unsavedModal.classList.add('active');
        } else {
            signOut(auth);
        }
    });
}

// === Navigation Logic ===
const unsavedModal = document.getElementById('unsaved-changes-modal');
const btnCancelNav = document.getElementById('btn-cancel-nav');
const btnConfirmNav = document.getElementById('btn-confirm-nav');

function switchTab(link) {
    const target = link.dataset.target;
    const prevLink = document.querySelector('.nav-link.active');
    const prevTarget = prevLink ? prevLink.dataset.target : null;

    navLinks.forEach(l => l.classList.remove('active'));
    viewSections.forEach(s => s.classList.remove('active'));
    link.classList.add('active');
    const targetEl = document.getElementById(target);
    if (targetEl) targetEl.classList.add('active');

    // Update history tracker's context
    history.setSection(target);

    if (target === 'section-podcast') loadSubtitles();
    if (target === 'section-analytics') initAnalyticsDashboard();
    if (target === 'section-testimonials') loadTestimonials();
    if (target === 'section-guide') initGuideProfileManager();
    if (target === 'section-admin-users') loadAdminUsers();
    if (target === 'section-portal-canvas') loadPortalConfig();
    if (window.innerWidth <= 1024) sidebar.classList.remove('active');
}

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (hasUnsavedChanges) {
            pendingNavTarget = link;
            unsavedModal.classList.add('active');
        } else {
            switchTab(link);
        }
    });
});

if (btnCancelNav) {
    btnCancelNav.onclick = () => {
        unsavedModal.classList.remove('active');
        pendingNavTarget = null;
    };
}

if (btnConfirmNav) {
    btnConfirmNav.onclick = () => {
        // DISCARD LOGIC
        const prevLink = document.querySelector('.nav-link.active');
        const prevSection = prevLink ? prevLink.dataset.target : null;

        if (prevSection && savedSectionStates[prevSection]) {
            console.log(`Discarding changes for ${prevSection}, restoring to last saved state.`);
            window.SectionStateManager[prevSection].restore(savedSectionStates[prevSection]);
        }

        hasUnsavedChanges = false;
        unsavedModal.classList.remove('active');

        if (pendingNavTarget) {
            switchTab(pendingNavTarget);
            pendingNavTarget = null;
        } else if (pendingNavAction === 'logout') {
            signOut(auth);
            pendingNavAction = null;
        } else if (pendingNavAction === 'home') {
            window.location.href = '/';
            pendingNavAction = null;
        }
    };
}

// === Testimonial Precision Controls ===
let activeTestimonialId = null;

window.selectTestimonialPhoto = (id) => {
    // Clear previous selection
    document.querySelectorAll('.bubble-preview').forEach(b => {
        b.style.border = '3px solid var(--accent-gold)';
        b.style.boxShadow = 'none';
    });

    activeTestimonialId = id;
    const preview = document.getElementById(`preview-${id}`).parentElement;
    preview.style.border = '3px solid #fff';
    preview.style.boxShadow = '0 0 15px var(--accent-gold)';

    showSnackbar("Keyboard mode: Use ARROWS to nudge. (+Shift for speed)");
};

document.addEventListener('keydown', (e) => {
    if (!activeTestimonialId) return;

    // Ignore keydown nudges if typing in any text input/textarea!
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const img = document.getElementById(`preview-${activeTestimonialId}`);
    if (!img) return;

    const card = img.closest('.glass-card');
    const xInput = card.querySelector('.focal-x');
    const yInput = card.querySelector('.focal-y');
    const scaleInput = card.querySelector('.test-scale');

    let x = parseInt(xInput.value);
    let y = parseInt(yInput.value);
    let scale = parseFloat(scaleInput.value) || 1.0;
    const step = e.shiftKey ? 5 : 1;
    const zoomStep = e.shiftKey ? 0.1 : 0.02;

    if (e.key === 'ArrowLeft') x = Math.max(0, x - step);
    else if (e.key === 'ArrowRight') x = Math.min(100, x + step);
    else if (e.key === 'ArrowUp') y = Math.max(0, y - step);
    else if (e.key === 'ArrowDown') y = Math.min(100, y + step);
    else if (e.key === '+' || e.key === '=') scale += zoomStep;
    else if (e.key === '-' || e.key === '_') scale = Math.max(0.5, scale - zoomStep);
    else return;

    e.preventDefault();
    xInput.value = x;
    yInput.value = y;
    scaleInput.value = scale.toFixed(2);

    img.style.objectPosition = `${x}% ${y}%`;
    img.style.transform = `scale(${scale})`;
});

mobileToggle.onclick = () => sidebar.classList.toggle('active');

btnBackToSite.onclick = () => {
    if (hasUnsavedChanges) {
        pendingNavAction = 'home';
        unsavedModal.classList.add('active');
    } else {
        returnSiteModal.classList.add('active');
    }
};
btnModalCancel.onclick = () => returnSiteModal.classList.remove('active');
btnModalConfirm.onclick = () => window.location.href = '/';

// === Settings Logic ===
async function loadSettings() {
    const snap = await getDoc(doc(db, "site_settings", "globals"));
    if (snap.exists()) {
        const data = snap.data();
        setEmail.value = data.email || '';
        setWa.value = data.whatsapp || '';
        setWaLink.value = data.whatsappLink || '';
        if (setAddress) {
            setAddress.value = data.address || 'Plot 141 Monde Village, Victoria Falls, Zimbabwe.';
        }

        // Populate privacy policy fields
        const p = data.privacyPolicy || {};
        document.getElementById('privacy-minimization-title').value = p.minimizationTitle || 'Data Minimization';
        document.getElementById('privacy-minimization-content').value = p.minimizationContent || 'Dean McGregor Safaris is a "Zero-Storage" entity. This website does not store, process, or transmit personal data through its own server architecture. All communications are direct via third-party secure providers (WhatsApp/Email).';
        document.getElementById('privacy-forgotten-title').value = p.forgottenTitle || 'Right to be Forgotten';
        document.getElementById('privacy-forgotten-content').value = p.forgottenContent || 'In accordance with Zimbabwean law, you have the right to request the deletion of your contact information from our private records. To do so, please contact Dean directly via WhatsApp or Email with the subject "Data Deletion Request".';
        document.getElementById('privacy-cookie-title').value = p.cookieTitle || 'Cookie Policy';
        document.getElementById('privacy-cookie-content').value = p.cookieContent || 'We believe in Privacy by Design. This website uses zero tracking, marketing, or analytical cookies. Your browsing experience is completely private.';
        document.getElementById('privacy-governing-title').value = p.governingTitle || 'Governing Law';
        document.getElementById('privacy-governing-content').value = p.governingContent || 'This policy and all data matters are governed by the Postal and Telecommunications Regulatory Authority of Zimbabwe (Potraz) under the Cyber and Data Protection Act [Chapter 12:42].';
    }
}

if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const sanitizedWaLink = setWaLink.value.replace(/\D/g, ''); // Ensure only digits for the link
            await setDoc(doc(db, "site_settings", "globals"), {
                email: setEmail.value,
                whatsapp: setWa.value,
                whatsappLink: sanitizedWaLink,
                address: setAddress.value
            }, { merge: true });
            hasUnsavedChanges = false;
            saveSectionSnapshot('section-settings');
            history.clear();
            showSnackbar("Settings Updated Successfully");
        } catch (error) {
            alert("Error updating settings.");
        }
    });
}

const privacyForm = document.getElementById('privacy-form');
if (privacyForm) {
    privacyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const minimizationTitle = document.getElementById('privacy-minimization-title').value;
            const minimizationContent = document.getElementById('privacy-minimization-content').value;
            const forgottenTitle = document.getElementById('privacy-forgotten-title').value;
            const forgottenContent = document.getElementById('privacy-forgotten-content').value;
            const cookieTitle = document.getElementById('privacy-cookie-title').value;
            const cookieContent = document.getElementById('privacy-cookie-content').value;
            const governingTitle = document.getElementById('privacy-governing-title').value;
            const governingContent = document.getElementById('privacy-governing-content').value;

            await setDoc(doc(db, "site_settings", "globals"), {
                privacyPolicy: {
                    minimizationTitle,
                    minimizationContent,
                    forgottenTitle,
                    forgottenContent,
                    cookieTitle,
                    cookieContent,
                    governingTitle,
                    governingContent
                }
            }, { merge: true });

            hasUnsavedChanges = false;
            saveSectionSnapshot('section-settings');
            history.clear();
            showSnackbar("Privacy Policy Updated Successfully");
        } catch (error) {
            alert("Error updating privacy policy.");
        }
    });
}

// === Safaris Overhaul Logic ===
function getSortedParkIds() {
    return Object.keys(safarisData.parks)
        .filter(id => !['hwange-national-park', 'new-operations'].includes(id))
        .sort((a, b) => {
            const orderA = safarisData.parks[a].order !== undefined ? safarisData.parks[a].order : 999;
            const orderB = safarisData.parks[b].order !== undefined ? safarisData.parks[b].order : 999;
            return orderA - orderB;
        });
}

function updateOperationsUnsavedStatus(status) {
    hasUnsavedChanges = status;
    const badge = document.getElementById('operations-unsaved-badge');
    if (badge) {
        badge.style.display = status ? 'inline-block' : 'none';
    }
}

async function loadSafarisDashboard() {
    try {
        // Load Intro
        const introSnap = await getDoc(doc(db, "site_config", "safaris_page"));
        if (introSnap.exists()) {
            document.getElementById('safari-intro-text').value = introSnap.data().intro || '';
        }

        // Load Parks
        const parksSnap = await getDocs(collection(db, "park_operations"));
        safarisData.parks = {};
        const coreOrderMap = { 'zambezi': 0, 'hwange': 1, 'mana-pools': 2, 'gonarezhou': 3 };

        parksSnap.forEach(docSnap => {
            const id = docSnap.id;
            if (['hwange-national-park', 'new-operations'].includes(id)) return;

            const data = docSnap.data();
            let order = data.order;
            if (order === undefined && coreOrderMap[id] !== undefined) {
                order = coreOrderMap[id];
            }
            safarisData.parks[id] = { id, order, ...data };
            if (safarisData.parks[id].show_seasonal_schematic === undefined) {
                safarisData.parks[id].show_seasonal_schematic = true;
            }
        });

        // Async clean up of legacy records in Firebase
        const legacyDocs = ['hwange-national-park', 'new-operations'];
        for (const id of legacyDocs) {
            try {
                await deleteDoc(doc(db, "park_operations", id));
            } catch (e) {
                console.warn(`Could not delete legacy park ${id}:`, e);
            }
        }

        safarisData.extras = [];
        renderSchematicEditors();
        renderParkInfoEditors();
    } catch (err) {
        console.error("Dashboard load failed:", err);
    }
}

function renderSchematicEditors() {
    const container = document.getElementById('schematic-editors-container');
    container.innerHTML = '';

    const sortedIds = getSortedParkIds();
    sortedIds.forEach(id => {
        const park = safarisData.parks[id] || { title: id, months: Array(12).fill('excellent') };
        const months = park.months || Array(12).fill('excellent');

        const div = document.createElement('div');
        div.className = 'schematic-park-block';
        div.dataset.park = id;
        div.style.display = park.show_seasonal_schematic !== false ? 'block' : 'none';
        div.innerHTML = `
            <h4 style="margin-bottom: 1rem; color: var(--sunset-gold); text-transform: capitalize; cursor: grab;"><i class="fas fa-grip-lines" style="margin-right: 8px; opacity: 0.5;"></i>${park.title}</h4>
            <div class="seasonal-grid-editor" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem;" data-park="${id}">
                ${months.map((status, i) => `
                    <div class="month-selector">
                        <label style="display: block; font-size: 0.6rem; margin-bottom: 2px; opacity: 0.5;">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]}</label>
                        <select class="month-status-input" data-index="${i}" style="font-size: 0.8rem; padding: 4px;">
                            <option value="excellent" ${status === 'excellent' ? 'selected' : ''}>Exc</option>
                            <option value="good" ${status === 'good' ? 'selected' : ''}>Good</option>
                            <option value="poor" ${status === 'poor' ? 'selected' : ''}>Possible</option>
                            <option value="closed" ${status === 'closed' ? 'selected' : ''}>Closed</option>
                        </select>
                    </div>
                `).join('')}
            </div>
        `;
        container.appendChild(div);
    });

    // Initialize SortableJS on schematic grids container
    if (window.Sortable) {
        if (window.schematicSortable) window.schematicSortable.destroy();
        window.schematicSortable = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: () => {
                const blocks = container.querySelectorAll('.schematic-park-block');
                blocks.forEach((block, index) => {
                    const id = block.dataset.park;
                    if (safarisData.parks[id]) {
                        safarisData.parks[id].order = index;
                    }
                });

                hasUnsavedChanges = true;
                updateOperationsUnsavedStatus(true);

                // Re-render park info cards to align matching orders
                renderParkInfoEditors();
            }
        });
    }
}

function renderParkInfoEditors() {
    const container = document.getElementById('park-info-editors-container');
    container.innerHTML = '';

    const sortedIds = getSortedParkIds();
    sortedIds.forEach(id => {
        const park = safarisData.parks[id] || { title: id, description: '', bullets: '', hero_img_url: '' };

        const div = document.createElement('div');
        div.className = 'park-info-block glass-card';
        div.dataset.parkBlock = id;
        div.style.padding = '2rem';
        div.style.position = 'relative';
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; cursor: grab;">
                <h4 style="margin: 0; color: var(--sunset-gold); font-family: var(--font-primary); text-transform: capitalize;"><i class="fas fa-grip-lines" style="margin-right: 8px; opacity: 0.5;"></i>${park.title || id}</h4>
                <button type="button" class="btn-primary" onclick="window.deletePark('${id}')" style="background: #ff6b6b; padding: 4px 10px; font-size: 0.7rem; margin: 0;">Delete Park</button>
            </div>
            <div class="form-group">
                <label>Park Display Name</label>
                <input type="text" class="park-title-input" value="${park.title}" data-park="${id}">
            </div>
            <div class="form-group">
                <label>Description (Main Text)</label>
                <textarea class="park-description-input" rows="4" data-park="${id}">${park.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Highlights (Bullets - One per line)</label>
                <textarea class="park-bullets-input" rows="4" data-park="${id}">${park.bullets || ''}</textarea>
            </div>
            <label class="switch-container" style="margin-top: 0.5rem; margin-bottom: 1.5rem;">
                <input type="checkbox" class="switch-input park-schematic-toggle" data-park="${id}" ${park.show_seasonal_schematic !== false ? 'checked' : ''} onchange="window.handleSchematicToggle(this, '${id}')">
                <span class="switch-slider"></span>
                <span class="switch-label">Display Seasonal Schematic on Website</span>
            </label>
            <div class="form-group">
                <label>Spotlight Photo</label>
                <input type="file" class="park-file-input" data-park="${id}" accept="image/*">
                <input type="hidden" class="park-url-input" value="${park.hero_img_url || ''}" data-park="${id}">
                <div class="park-preview" style="margin-top: 1rem; height: 120px; background: rgba(0,0,0,0.05); border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                    ${park.hero_img_url ? `<img src="${park.hero_img_url}" style="max-height: 100%;">` : '<span style="opacity: 0.4;">No image</span>'}
                </div>
            </div>
        `;
        container.appendChild(div);
    });

    // Initialize SortableJS on park info editors container
    if (window.Sortable) {
        if (window.parkSortable) window.parkSortable.destroy();
        window.parkSortable = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: () => {
                const blocks = container.querySelectorAll('.park-info-block');
                blocks.forEach((block, index) => {
                    const id = block.dataset.parkBlock;
                    if (safarisData.parks[id]) {
                        safarisData.parks[id].order = index;
                    }
                });

                hasUnsavedChanges = true;
                updateOperationsUnsavedStatus(true);

                // Re-render seasonal grids to align matching orders
                renderSchematicEditors();
            }
        });
    }
}

window.handleSchematicToggle = (input, id) => {
    if (safarisData.parks[id]) {
        safarisData.parks[id].show_seasonal_schematic = input.checked;
    }

    // Instantly toggle visibility of corresponding seasonal chart block below
    const block = document.querySelector(`.schematic-park-block[data-park="${id}"]`);
    if (block) {
        block.style.display = input.checked ? 'block' : 'none';
    }

    // Mark state as unsaved and pulse badge
    hasUnsavedChanges = true;
    updateOperationsUnsavedStatus(true);

    // Push action to Undo/Redo history
    history.push('schematic_toggle_change', window.SectionStateManager['section-operations'].capture(), true);
};

// --- Save Functions ---
async function saveAllOperations() {
    const btn = document.getElementById('btn-save-all-park-info');
    const schematicBtn = document.getElementById('btn-save-all-schematics');

    // Disable both save buttons
    if (btn) { btn.disabled = true; btn.textContent = "Saving All Changes..."; }
    if (schematicBtn) { schematicBtn.disabled = true; schematicBtn.textContent = "Saving All Changes..."; }

    showSnackbar("Saving operations configuration...");

    try {
        // 1. First, capture current state of DOM fields into the in-memory safarisData object
        window.SectionStateManager['section-operations'].capture();

        // 2. Upload any new spotlight photos selected for active parks
        const activeIds = getSortedParkIds();

        for (const id of activeIds) {
            const park = safarisData.parks[id];
            const block = document.querySelector(`.park-info-block[data-park-block="${id}"]`);
            if (block) {
                const fileInput = block.querySelector('.park-file-input');
                if (fileInput && fileInput.files[0]) {
                    showSnackbar(`Uploading spotlight photo for ${park.title}...`);
                    const file = fileInput.files[0];
                    const washed = await washImage(file, 1600);
                    const timestamp = Date.now();
                    const fileName = `safaris/${timestamp}_${file.name}`;
                    const fbRef = ref(storage, fileName);

                    // Cleanup: Delete the old spotlight image via server (Admin SDK bypasses rules)
                    await deleteStorageFileViaServer(park.hero_img_url);

                    await uploadBytes(fbRef, washed);
                    const url = await getDownloadURL(fbRef);
                    park.hero_img_url = url;

                    // Update preview and hidden fields
                    const preview = block.querySelector('.park-preview');
                    if (preview) preview.innerHTML = `<img src="${url}" style="max-height: 100%;">`;
                    const urlInput = block.querySelector('.park-url-input');
                    if (urlInput) urlInput.value = url;
                }
            }
        }

        // 3. Purge deleted parks from Firestore
        const parksSnap = await getDocs(collection(db, "park_operations"));
        for (const docObj of parksSnap.docs) {
            const docId = docObj.id;
            if (['hwange-national-park', 'new-operations'].includes(docId)) {
                await deleteDoc(docObj.ref);
                continue;
            }
            if (!activeIds.includes(docId)) {
                console.log(`Deleting removed park profile: ${docId}`);
                await deleteDoc(docObj.ref);
            }
        }

        // 4. Save all active parks (smart-hide: skip parks with no meaningful content)
        for (const id of activeIds) {
            const park = safarisData.parks[id];
            const titleIsDefault = !park.title || park.title.trim() === 'New Park';
            const hasContent = park.description?.trim() || park.bullets?.trim() || park.hero_img_url?.trim();

            if (titleIsDefault && !hasContent) {
                // Blank placeholder park — purge from Firestore silently and skip
                console.log(`Smart-hiding blank park: ${id}`);
                try { await deleteDoc(doc(db, "park_operations", id)); } catch (e) { }
                continue;
            }

            await setDoc(doc(db, "park_operations", id), {
                title: park.title || '',
                description: park.description || '',
                bullets: park.bullets || '',
                hero_img_url: park.hero_img_url || '',
                months: park.months || Array(12).fill('excellent'),
                order: park.order,
                show_seasonal_schematic: park.show_seasonal_schematic !== false,
                updated_at: serverTimestamp()
            }, { merge: true });
        }

        // 5. Save Intro Text
        const introText = document.getElementById('safari-intro-text').value;
        await setDoc(doc(db, "site_config", "safaris_page"), { intro: introText, updatedAt: serverTimestamp() }, { merge: true });

        // 6. Save Main Gateway Panel
        const panelData = {
            title: document.getElementById('panel-title').value,
            description: document.getElementById('panel-desc').value,
            imageUrl: document.getElementById('panel-image-url').value,
            updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, "site_config", "safaris_main_panel"), panelData, { merge: true });

        // 7. Save Travel & Access Info
        const travelData = {
            title: document.getElementById('travel-title').value,
            content: document.getElementById('travel-content').value,
            updatedAt: serverTimestamp()
        };
        await setDoc(doc(db, "site_config", "safaris_travel"), travelData, { merge: true });

        // 8. Purge all legacy Extra Zig-Zag Sections from Firestore
        const extrasSnap = await getDocs(collection(db, "safari_extras"));
        for (const docObj of extrasSnap.docs) {
            await deleteDoc(docObj.ref);
        }
        safarisData.extras = [];

        hasUnsavedChanges = false;
        updateOperationsUnsavedStatus(false);
        saveSectionSnapshot('section-operations');
        history.clear();
        updateLiveQuotaMetrics(true); // Recalculate Storage immediately!
        showSnackbar("All operations, schematics, and configs saved successfully!");
        await loadSafarisDashboard();
    } catch (err) {
        console.error("Failed to save operations details:", err);
        showSnackbar("Error saving operations: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Save & Update Website (All Park Info)"; }
        if (schematicBtn) { schematicBtn.disabled = false; schematicBtn.textContent = "Save & Update Website (All Schematics)"; }
    }
}

async function loadOperations() {
    await loadSafarisDashboard();

    // Wire up "+ Add New Park" inline action button
    const btnAddPark = document.getElementById('btn-add-park');
    if (btnAddPark) {
        btnAddPark.onclick = () => {
            const id = "park_" + Date.now();
            const sortedIds = getSortedParkIds();
            const newOrder = sortedIds.length;

            safarisData.parks[id] = {
                id: id,
                title: "New Park",
                description: "",
                bullets: "",
                hero_img_url: "",
                months: Array(12).fill('excellent'),
                show_seasonal_schematic: true,
                order: newOrder
            };

            hasUnsavedChanges = true;
            updateOperationsUnsavedStatus(true);

            renderParkInfoEditors();
            renderSchematicEditors();

            setTimeout(() => {
                const card = document.querySelector(`.park-info-block[data-park-block="${id}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        };
    }

    // Load Main Panel
    try {
        const panelSnap = await getDoc(doc(db, "site_config", "safaris_main_panel"));
        if (panelSnap.exists()) {
            const data = panelSnap.data();
            document.getElementById('panel-title').value = data.title || '';
            document.getElementById('panel-desc').value = data.description || '';
            document.getElementById('panel-image-url').value = data.imageUrl || '';
            if (data.imageUrl) {
                document.getElementById('panel-image-preview').innerHTML = `<img src="${data.imageUrl}" style="width:100%; height:100%; object-fit:cover;">`;
            }
        }
    } catch (e) { console.error("Error loading panel:", e); }

    // Load Travel Info
    try {
        const travelSnap = await getDoc(doc(db, "site_config", "safaris_travel"));
        if (travelSnap.exists()) {
            const data = travelSnap.data();
            document.getElementById('travel-title').value = data.title || '';
            document.getElementById('travel-content').value = data.content || '';
        }
    } catch (e) { console.error("Error loading travel info:", e); }
}

window.deletePark = (id) => {
    const title = (safarisData.parks[id] && safarisData.parks[id].title) || id;
    if (confirm(`Are you sure you want to permanently delete the park "${title}"? This action will also delete its synchronized seasonal schematic matrix.`)) {
        delete safarisData.parks[id];

        // Auto-heal orders of remaining parks
        const sortedIds = getSortedParkIds();
        sortedIds.forEach((activeId, index) => {
            safarisData.parks[activeId].order = index;
        });

        hasUnsavedChanges = true;
        updateOperationsUnsavedStatus(true);

        // Re-render lists
        renderParkInfoEditors();
        renderSchematicEditors();

        showSnackbar(`Park "${title}" removed locally. Click Save to commit changes.`);
    }
};

document.getElementById('panel-image').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showSnackbar("Uploading panel image...");
    try {
        const washed = await washImage(file, 2000);
        const fbRef = ref(storage, `safaris/main_panel_${Date.now()}`);

        // Cleanup: Delete the old main panel image via server (Admin SDK bypasses rules)
        const oldUrl = document.getElementById('panel-image-url').value;
        await deleteStorageFileViaServer(oldUrl);

        await uploadBytes(fbRef, washed);
        const url = await getDownloadURL(fbRef);
        document.getElementById('panel-image-url').value = url;
        document.getElementById('panel-image-preview').innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
        showSnackbar("Image uploaded!");
    } catch (err) {
        console.error(err);
        showSnackbar("Upload failed.");
    }
};

document.getElementById('safari-panel-form').onsubmit = async (e) => {
    e.preventDefault();
    await saveAllOperations();
};

document.getElementById('safari-travel-form').onsubmit = async (e) => {
    e.preventDefault();
    await saveAllOperations();
};

document.getElementById('safari-intro-form').onsubmit = async (e) => {
    e.preventDefault();
    await saveAllOperations();
};

document.getElementById('btn-save-all-schematics').onclick = async () => {
    await saveAllOperations();
};

document.getElementById('btn-save-all-park-info').onclick = async () => {
    await saveAllOperations();
};



// Initialize load
loadSafarisDashboard();

// === Admin Managers Logic ===
async function loadAdminUsers() {
    const listContainer = document.getElementById('admin-users-list');
    if (!listContainer) return;

    listContainer.innerHTML = '<p>Loading...</p>';

    try {
        const snap = await getDocs(collection(db, "admin_users"));
        if (snap.empty) {
            listContainer.innerHTML = '<p>No admins found.</p>';
            return;
        }

        listContainer.innerHTML = '';
        snap.forEach(docSnap => {
            const email = docSnap.id;
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.padding = '1rem';
            div.style.background = 'rgba(0,0,0,0.02)';
            div.style.border = '1px solid rgba(0,0,0,0.05)';
            div.style.borderRadius = '8px';

            const isCurrentUser = (auth.currentUser && auth.currentUser.email === email);

            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <i class="fas fa-user-shield" style="color: var(--accent-gold); font-size: 1.5rem;"></i>
                    <span style="font-weight: 600;">${email} ${isCurrentUser ? '<span style="font-size:0.7rem; background:var(--accent-gold); color:white; padding:2px 6px; border-radius:4px; margin-left:8px;">YOU</span>' : ''}</span>
                </div>
                <button class="btn-primary" style="background: #ff6b6b; padding: 0.5rem 1rem; font-size: 0.8rem;" onclick="removeAdminUser('${email}')">Remove</button>
            `;
            listContainer.appendChild(div);
        });
    } catch (error) {
        console.error("Error loading admins:", error);
        listContainer.innerHTML = '<p style="color:red;">Error loading admins. Ensure you have permission.</p>';
    }
}

document.getElementById('btn-add-admin').onclick = async () => {
    const input = document.getElementById('new-admin-email');
    const email = input.value.trim().toLowerCase();

    if (!email || !email.includes('@')) {
        showSnackbar('Please enter a valid email address.');
        return;
    }

    const btn = document.getElementById('btn-add-admin');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        const createAdminAccount = httpsCallable(functions, 'createAdminAccount');
        const result = await createAdminAccount({ email: email });

        if (result.data.wasCreated) {
            // Trigger the password reset email automatically!
            await sendPasswordResetEmail(auth, email);
            alert(`Admin account created successfully!\n\nAn official password reset email has been sent to: ${email}\n\nThey must click the link in their inbox to set a secure password before logging in.`);
        } else {
            showSnackbar('Admin added successfully (Account already existed).');
        }

        input.value = '';
        loadAdminUsers();
    } catch (error) {
        console.error("Error adding admin:", error);
        alert('Failed to add admin: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Admin';
    }
};

window.removeAdminUser = async (email) => {
    if (auth.currentUser && auth.currentUser.email === email) {
        alert("Action Denied: You cannot remove your own admin access while logged in.");
        return;
    }

    if (confirm(`Are you sure you want to revoke dashboard access and permanently delete the account for ${email}?`)) {
        try {
            const deleteAdminAccount = httpsCallable(functions, 'deleteAdminAccount');
            await deleteAdminAccount({ email: email });
            showSnackbar('Admin and login account completely removed.');
            loadAdminUsers();
        } catch (error) {
            console.error("Error removing admin:", error);
            alert('Failed to remove admin: ' + error.message);
        }
    }
};

// === Gallery Logic ===
async function loadGalleries() {
    // We fetch all galleries. If 'order' is missing, they'll still show up.
    // We'll sort them in memory for now to prevent Firestore from hiding ones without the 'order' field.

    // 1. Clean, one-shot fetch to guarantee complete initial data load
    try {
        const snap = await getDocs(collection(db, "client_galleries"));
        galleriesData = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                is_placed_in_mosaic: data.is_placed_in_mosaic !== false, // Defaults to true if missing!
                ...data
            };
        });
        // Sort: items with 'order' first, then by 'createdAt'
        galleriesData.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            if (a.order !== undefined) return -1;
            if (b.order !== undefined) return 1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });
        renderGalleriesList();
    } catch (error) {
        console.error("Error doing initial load of galleries:", error);
    }

    // 2. Attach background onSnapshot listener for subsequent real-time database updates
    onSnapshot(collection(db, "client_galleries"), (snap) => {
        galleriesData = snap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                is_placed_in_mosaic: data.is_placed_in_mosaic !== false, // Defaults to true if missing!
                ...data
            };
        });
        // Sort: items with 'order' first, then by 'createdAt'
        galleriesData.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            if (a.order !== undefined) return -1;
            if (b.order !== undefined) return 1;
            return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
        });
        renderGalleriesList();

        // If the user is currently looking at the Portal Canvas editor, re-render it in real-time
        const activeTab = document.querySelector('.nav-link.active');
        if (activeTab && activeTab.dataset.target === 'section-portal-canvas') {
            renderPortalCanvas();
        }
    });
}

function updateGalleryUnsavedStatus(isUnsaved) {
    hasUnsavedChanges = isUnsaved;
    const galleryUnsavedBadge = document.getElementById('gallery-unsaved-badge');
    if (galleryUnsavedBadge) {
        galleryUnsavedBadge.style.display = isUnsaved ? 'inline-flex' : 'none';
    }
}

function renderGalleriesList() {
    galleryListContainer.innerHTML = '';
    galleriesData.forEach(g => {
        const div = document.createElement('div');
        div.className = 'glass-card gallery-item-drag';
        div.dataset.id = g.id;
        div.style.padding = '1.5rem';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.cursor = 'grab';
        div.innerHTML = `
            <div style="display: flex; align-items: center; gap: 1rem;">
                <i class="fas fa-grip-lines" style="opacity: 0.3;"></i>
                <div>
                    <strong style="font-size: 1.1rem;">${g.title}</strong>
                    <div style="opacity: 0.6; font-size: 0.8rem;">${g.photos?.length || 0} Photos</div>
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button class="btn-primary btn-small" onclick="window.editGallery('${g.id}')" style="background: #666;">Edit</button>
                <button class="btn-primary btn-small" onclick="window.confirmDeleteGallery('${g.id}')" style="background: #ff6b6b;">Delete</button>
            </div>
        `;
        galleryListContainer.appendChild(div);
    });

    if (window.collectionSortable) window.collectionSortable.destroy();
    window.collectionSortable = new Sortable(galleryListContainer, {
        animation: 150,
        draggable: '.gallery-item-drag',
        onEnd: () => {
            const items = Array.from(galleryListContainer.querySelectorAll('.gallery-item-drag'));
            const newOrder = items.map(el => {
                const id = el.dataset.id;
                return galleriesData.find(g => g.id === id);
            });
            galleriesData = newOrder;
            updateGalleryUnsavedStatus(true);
            history.push('gallery_list_reorder', window.SectionStateManager['section-gallery'].capture(), true);

            // Show the specific save button for list order
            const btnSaveOrder = document.getElementById('btn-save-gallery-order-global');
            if (btnSaveOrder) btnSaveOrder.style.display = 'block';

            renderGalleriesList();
        }
    });
}

const btnSaveGalleryOrderGlobal = document.getElementById('btn-save-gallery-order-global');
if (btnSaveGalleryOrderGlobal) {
    btnSaveGalleryOrderGlobal.onclick = async () => {
        btnSaveGalleryOrderGlobal.disabled = true;
        btnSaveGalleryOrderGlobal.textContent = "Saving...";
        try {
            for (let i = 0; i < galleriesData.length; i++) {
                const id = galleriesData[i].id;
                await setDoc(doc(db, "client_galleries", id), { order: i }, { merge: true });
            }
            hasUnsavedChanges = false;
            saveSectionSnapshot('section-gallery');
            history.clear();
            btnSaveGalleryOrderGlobal.style.display = 'none';
            showSnackbar("Gallery order saved!");
        } catch (err) {
            console.error(err);
            alert("Error saving gallery order.");
        } finally {
            btnSaveGalleryOrderGlobal.disabled = false;
            btnSaveGalleryOrderGlobal.textContent = "Save List Order";
        }
    };
}

window.editGallery = (id) => {
    const g = galleriesData.find(gal => gal.id === id);
    document.getElementById('gallery-id').value = g.id;
    galleryTitleInput.value = g.title;
    // Standardize photo format to objects
    existingGalleryPhotos = (g.photos || []).map(p => {
        if (typeof p === 'string') return { url: p, focal: { x: 50, y: 50 } };
        return { ...p, focal: p.focal || { x: 50, y: 50 } };
    });
    albumCoverUrl = g.albumCover || '';

    // Backward compatible parser for heroImage
    if (g.heroImage) {
        if (typeof g.heroImage === 'string') {
            heroImageUrl = g.heroImage;
            heroImageObj = { url: g.heroImage, focal: { x: 50, y: 50 } };
        } else {
            heroImageObj = { ...g.heroImage };
            heroImageUrl = g.heroImage.url || '';
        }
    } else {
        heroImageUrl = '';
        heroImageObj = null;
    }

    galleryPhotosToUpload = [];
    selectedPhotoIdx = null;
    currentTemplate = g.template || 't1';

    updateTemplateUI();
    renderLiveGrid();
    uploadQueueContainer.style.display = 'none';
    galleryListView.style.display = 'none';
    galleryEditorView.style.display = 'block';
};

btnCreateGallery.onclick = () => {
    galleryForm.reset();
    document.getElementById('gallery-id').value = '';
    existingGalleryPhotos = [];
    galleryPhotosToUpload = [];
    albumCoverUrl = '';
    heroImageUrl = '';
    heroImageObj = null;
    renderLiveGrid();
    uploadQueueContainer.style.display = 'none';
    galleryListView.style.display = 'none';
    galleryEditorView.style.display = 'block';
};

btnCancelGalleryEdit.onclick = () => {
    galleryEditorView.style.display = 'none';
    galleryListView.style.display = 'block';
};

galleryPhotoInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    galleryPhotosToUpload = [...galleryPhotosToUpload, ...files];
    renderUploadQueue();
};

function renderUploadQueue() {
    uploadQueueList.innerHTML = '';
    if (galleryPhotosToUpload.length > 0) {
        uploadQueueContainer.style.display = 'block';
        galleryPhotosToUpload.forEach((file, idx) => {
            const div = document.createElement('div');
            div.style = "display:flex; justify-content:space-between; font-size:0.8rem; padding:0.4rem; border-bottom:1px solid #eee;";
            div.innerHTML = `<span>${file.name}</span><button type="button" style="color:red; border:none; background:none; cursor:pointer;">&times;</button>`;
            div.querySelector('button').onclick = () => {
                galleryPhotosToUpload.splice(idx, 1);
                renderUploadQueue();
            };
            uploadQueueList.appendChild(div);
        });
    } else {
        uploadQueueContainer.style.display = 'none';
    }
}

function renderLiveGrid() {
    liveGridEditor.innerHTML = '';
    reorderStrip.innerHTML = '';

    existingGalleryPhotos.forEach((photoObj, idx) => {
        const url = photoObj.url;
        const focal = photoObj.focal || { x: 50, y: 50 };

        // Grid Item
        const item = document.createElement('div');
        item.className = 'live-grid-item';
        if (selectedPhotoIdx === idx) item.classList.add('selected');
        item.dataset.url = url;
        item.dataset.idx = idx;

        // --- Template Pattern Logic ---
        if (currentTemplate === 't1') {
            // Puzzle Mix
            const patternIndex = idx % 4;
            if (patternIndex === 0) item.classList.add('big');
            else if (patternIndex === 1) item.classList.add('wide');
        } else if (currentTemplate === 't2') {
            // Alt Rows (2-column focused)
            if (idx % 2 === 0) item.classList.add('wide');
        } else if (currentTemplate === 't3') {
            // Storyboards (Full width rows interspersed)
            if (idx % 4 === 0) item.classList.add('wide');
            if (idx % 4 === 0) item.style.gridColumn = 'span 4';
        } else if (currentTemplate === 't4') {
            // Mosaic (Vertical emphasis)
            if (idx % 3 === 2) {
                item.classList.add('big');
                item.style.gridRow = 'span 3';
            }
        }

        const isCover = url === albumCoverUrl;
        const isHero = url === heroImageUrl;
        item.innerHTML = `
            <img src="${url}" style="object-position: ${focal.x}% ${focal.y}%">
            <div class="focal-hint"><i class="fas fa-crop-alt"></i> Double-click to Edit Framing</div>
            ${isHero ? `
                <div class="hero-focal-hint" style="position: absolute; bottom: 8px; left: 8px; background: rgba(45, 106, 79, 0.95); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; pointer-events: none; z-index: 100; display: flex; align-items: center; gap: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    <i class="fas fa-crop-alt"></i> Dbl Right-Click to Position Hero
                </div>
            ` : ''}
            <div style="position:absolute; top:8px; right:8px; display:flex; gap:4px;">
                <button type="button" class="action-btn set-cover" title="Set as Album Cover" style="background:${isCover ? 'var(--accent-gold)' : 'rgba(0,0,0,0.5)'}; color:white; border:none; width:30px; height:30px; border-radius:4px; cursor:pointer;"><i class="fas fa-star"></i></button>
                <button type="button" class="action-btn set-hero" title="Set as Hero Image" style="background:${isHero ? '#2d6a4f' : 'rgba(0,0,0,0.5)'}; color:white; border:none; width:30px; height:30px; border-radius:4px; cursor:pointer;"><i class="fas fa-image"></i></button>
                <button type="button" class="action-btn adjust-framing" title="Adjust Framing" style="background:rgba(0,0,0,0.5); color:white; border:none; width:30px; height:30px; border-radius:4px; cursor:pointer;"><i class="fas fa-arrows-alt"></i></button>
                <button type="button" class="action-btn delete-photo" title="Remove Photo" style="background:rgba(255,0,0,0.5); color:white; border:none; width:30px; height:30px; border-radius:4px; cursor:pointer;"><i class="fas fa-trash"></i></button>
            </div>
        `;

        const btnCover = item.querySelector('.set-cover');
        btnCover.onclick = (e) => {
            e.stopPropagation();
            albumCoverUrl = url;
            hasUnsavedChanges = true;
            updateGalleryUnsavedStatus(true);
            history.push('set_cover', { albumCoverUrl }, true);
            renderLiveGrid();
        };

        const btnHero = item.querySelector('.set-hero');
        btnHero.onclick = (e) => {
            e.stopPropagation();
            heroImageUrl = url;
            heroImageObj = { url: url, focal: { x: 50, y: 50 } };
            hasUnsavedChanges = true;
            updateGalleryUnsavedStatus(true);
            history.push('set_hero', { heroImageUrl, heroImageObj }, true);
            renderLiveGrid();
        };

        const btnAdjust = item.querySelector('.adjust-framing');
        btnAdjust.onclick = (e) => {
            e.stopPropagation();
            window.openGalleryFocalEditor(idx);
        };

        const btnDelete = item.querySelector('.delete-photo');
        btnDelete.onclick = (e) => {
            e.stopPropagation();
            if (confirm("Remove this photo from the collection?")) {
                existingGalleryPhotos.splice(idx, 1);
                if (url === heroImageUrl) {
                    heroImageUrl = '';
                    heroImageObj = null;
                }
                hasUnsavedChanges = true;
                history.push('delete_photo', window.SectionStateManager['section-gallery'].capture(), true);
                renderLiveGrid();
            }
        };

        let lastPointerDownTime = 0;
        item.onpointerdown = (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return; // Only process left click/main pointer

            const now = Date.now();
            if (now - lastPointerDownTime < 300) {
                e.stopPropagation();
                window.openGalleryFocalEditor(idx);
                lastPointerDownTime = 0;
            } else {
                lastPointerDownTime = now;
                selectedPhotoIdx = idx;

                // Update selected classes in the DOM directly to avoid destructive full grid re-render!
                document.querySelectorAll('.live-grid-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
            }
        };

        // Custom double-right-click listener for hero framing adjustment
        item.oncontextmenu = (e) => {
            if (isHero) {
                e.preventDefault();
                const now = Date.now();
                const lastClick = parseFloat(item.getAttribute('data-last-right-click') || '0');
                item.setAttribute('data-last-right-click', now.toString());
                if (now - lastClick < 500) {
                    window.openHeroFocalEditor(idx);
                }
            }
        };

        liveGridEditor.appendChild(item);

        // Strip Item (Banner)
        const stripItem = document.createElement('div');
        stripItem.className = 'strip-item';
        stripItem.dataset.url = url;
        stripItem.dataset.idx = idx; // Added idx to prevent bug when retrieving new order
        stripItem.innerHTML = `<img src="${url}" style="object-position: ${focal.x}% ${focal.y}%">`;
        reorderStrip.appendChild(stripItem);
    });

    // Register Sortable Swap plugin if loaded from CDN and not already mounted
    if (window.Sortable && window.Sortable.Swap && !window.Sortable.activePlugins?.includes('Swap')) {
        window.Sortable.mount(new window.Sortable.Swap());
    }

    // Grid: Swap Mode
    if (window.liveGridSortable) window.liveGridSortable.destroy();
    window.liveGridSortable = new Sortable(liveGridEditor, {
        swap: true,
        swapClass: 'sortable-swap-highlight',
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        onEnd: (evt) => {
            const oldIdx = evt.oldIndex;
            const newIdx = evt.newIndex;
            if (oldIdx !== undefined && newIdx !== undefined && oldIdx !== newIdx) {
                // Swap the items inside existingGalleryPhotos array directly
                const temp = existingGalleryPhotos[oldIdx];
                existingGalleryPhotos[oldIdx] = existingGalleryPhotos[newIdx];
                existingGalleryPhotos[newIdx] = temp;
            }
            selectedPhotoIdx = null;
            hasUnsavedChanges = true;
            updateGalleryUnsavedStatus(true);
            history.push('gallery_reorder', window.SectionStateManager['section-gallery'].capture(), true);
            renderLiveGrid();
        }
    });

    // Strip: Insert Mode
    if (window.stripSortable) window.stripSortable.destroy();
    window.stripSortable = new Sortable(reorderStrip, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: () => {
            const items = Array.from(reorderStrip.querySelectorAll('.strip-item'));
            const newOrder = items.map(el => {
                const idx = parseInt(el.dataset.idx);
                return existingGalleryPhotos[idx];
            });
            existingGalleryPhotos = newOrder;
            selectedPhotoIdx = null;
            updateGalleryUnsavedStatus(true);
            history.push('gallery_reorder', window.SectionStateManager['section-gallery'].capture(), true);
            renderLiveGrid();
        }
    });
}

// Arrow Key Adjustment Logic
window.addEventListener('keydown', (e) => {
    // Ignore keydown nudges if typing in any text input/textarea!
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (activeGalleryFocalIndex !== null) return;
    if (selectedPhotoIdx === null || galleryEditorView.style.display === 'none') return;

    const photo = existingGalleryPhotos[selectedPhotoIdx];
    if (!photo.focal) photo.focal = { x: 50, y: 50 };

    const step = e.shiftKey ? 5 : 1;
    let changed = false;

    if (e.key === 'ArrowUp') { photo.focal.y = Math.max(0, photo.focal.y - step); changed = true; }
    if (e.key === 'ArrowDown') { photo.focal.y = Math.min(100, photo.focal.y + step); changed = true; }
    if (e.key === 'ArrowLeft') { photo.focal.x = Math.max(0, photo.focal.x - step); changed = true; }
    if (e.key === 'ArrowRight') { photo.focal.x = Math.min(100, photo.focal.x + step); changed = true; }

    if (changed) {
        e.preventDefault();
        const img = liveGridEditor.querySelector(`.live-grid-item[data-idx="${selectedPhotoIdx}"] img`);
        const stripImg = reorderStrip.querySelector(`.strip-item[data-url="${photo.url}"] img`);
        if (img) img.style.objectPosition = `${photo.focal.x}% ${photo.focal.y}%`;
        if (stripImg) stripImg.style.objectPosition = `${photo.focal.x}% ${photo.focal.y}%`;

        hasUnsavedChanges = true;
        history.push('focal_adjust', { existingGalleryPhotos });
    }
});

async function saveGalleryOrder() {
    const docId = document.getElementById('gallery-id').value;
    if (!docId) return;

    // Check for deleted photos
    const originalGallery = galleriesData.find(g => g.id === docId);
    let deletedPhotos = [];
    if (originalGallery && originalGallery.photos) {
        deletedPhotos = originalGallery.photos.filter(orig => {
            const origUrl = orig.url || orig;
            return !existingGalleryPhotos.some(curr => (curr.url || curr) === origUrl);
        });
    }

    if (deletedPhotos.length > 0) {
        if (!confirm(`Warning: Saving these changes will permanently delete ${deletedPhotos.length} removed photos from this gallery. This cannot be undone. Proceed?`)) {
            return;
        }
        showSnackbar("Cleaning up deleted photos...", false);
        for (const photo of deletedPhotos) {
            const url = photo.url || photo;
            await deleteStorageFileViaServer(url);
        }
    }

    try {
        const fallbackCover = existingGalleryPhotos[0]?.url || existingGalleryPhotos[0] || '';
        const galleryData = {
            title: galleryTitleInput.value,
            photos: existingGalleryPhotos,
            albumCover: albumCoverUrl || fallbackCover,
            cover_photo_url: albumCoverUrl || fallbackCover, // Assign both cover_photo_url and albumCover
            heroImage: heroImageObj || heroImageUrl || '',
            template: currentTemplate,
            updatedAt: serverTimestamp()
        };

        let isNew = false;
        if (!originalGallery) {
            galleryData.createdAt = serverTimestamp();
            galleryData.order = galleriesData.length;
            galleryData.is_placed_in_mosaic = false; // Staged launch state!
            isNew = true;
        } else {
            // Preserve the existing is_placed_in_mosaic flag
            galleryData.is_placed_in_mosaic = originalGallery.is_placed_in_mosaic !== false;
        }

        await setDoc(doc(db, "client_galleries", docId), galleryData, { merge: true });

        // Update original galleriesData cache so future saves work correctly
        const gIdx = galleriesData.findIndex(g => g.id === docId);
        if (gIdx !== -1) {
            galleriesData[gIdx].title = galleryTitleInput.value;
            galleriesData[gIdx].photos = JSON.parse(JSON.stringify(existingGalleryPhotos));
            galleriesData[gIdx].albumCover = galleryData.albumCover;
            galleriesData[gIdx].cover_photo_url = galleryData.cover_photo_url;
            galleriesData[gIdx].heroImage = galleryData.heroImage;
            galleriesData[gIdx].template = currentTemplate;
            galleriesData[gIdx].is_placed_in_mosaic = galleryData.is_placed_in_mosaic;
        } else {
            // New gallery - append to local cache
            galleriesData.push({
                id: docId,
                ...galleryData
            });
        }

        updateGalleryUnsavedStatus(false);
        saveSectionSnapshot('section-gallery');
        history.clear();
        updateLiveQuotaMetrics(true); // Recalculate Storage immediately!
        showSnackbar("Collection Layout Saved!");

        if (isNew) {
            // Trigger the specialized redirection modal popup!
            const createdModal = document.getElementById('collection-created-modal');
            if (createdModal) {
                createdModal.classList.add('active');
            }
        }
    } catch (err) {
        console.error("Sync error:", err);
        showSnackbar("Error saving layout: " + err.message);
    }
}

// Redirection prompt modal button wiring
const btnPortalRedirect = document.getElementById('btn-portal-redirect');
if (btnPortalRedirect) {
    btnPortalRedirect.onclick = () => {
        const portalLink = document.querySelector('.nav-link[data-target="section-portal-canvas"]');
        if (portalLink) {
            switchTab(portalLink);
        }
        document.getElementById('collection-created-modal').classList.remove('active');
    };
}

// Global button wiring
document.getElementById('btn-save-gallery-layout').onclick = () => saveGalleryOrder();

// Template Switcher Logic
templateCards.forEach(card => {
    card.addEventListener('click', () => {
        currentTemplate = card.dataset.template;
        updateTemplateUI();
        hasUnsavedChanges = true;
        history.push('template_change', { currentTemplate });
        renderLiveGrid();
    });
});

function updateTemplateUI() {
    templateCards.forEach(c => {
        c.classList.toggle('active', c.dataset.template === currentTemplate);
    });
}

previewDesktopBtn.onclick = () => {
    liveGridEditor.classList.remove('mobile');
    renderLiveGrid();
};

previewMobileBtn.onclick = () => {
    liveGridEditor.classList.add('mobile');
    renderLiveGrid();
};

galleryForm.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-uploads');
    btn.disabled = true;

    let docId = document.getElementById('gallery-id').value;
    if (!docId) {
        docId = generateSlug(galleryTitleInput.value) + '-' + Date.now();
        document.getElementById('gallery-id').value = docId;
    }

    // 1. Start the Upload & "Washing" Loop
    const uploadedUrls = [];
    for (const file of galleryPhotosToUpload) {
        showSnackbar(`Washing & Compressing: ${file.name}...`, false);

        // 2. Client-side Wash (strip metadata + resize to 2500px max)
        const washedFile = await washImage(file, 2500);

        const fileName = `${Date.now()}-${file.name}`;
        const sRef = ref(storage, `galleries/${docId}/${fileName}`);

        const snapshot = await uploadBytes(sRef, washedFile);
        const publicUrl = await getDownloadURL(snapshot.ref);
        uploadedUrls.push(publicUrl);
    }

    // 3. Staging Local State (Instead of direct publishing)
    const newPhotoObjects = uploadedUrls.map(url => ({ url, focal: { x: 50, y: 50 } }));

    // Capture state before modifying to push to undo/redo history
    history.push('gallery_upload', window.SectionStateManager['section-gallery'].capture(), true);

    existingGalleryPhotos = [...existingGalleryPhotos, ...newPhotoObjects];
    galleryPhotosToUpload = [];

    renderUploadQueue();
    renderLiveGrid();
    updateGalleryUnsavedStatus(true);
    updateLiveQuotaMetrics(true); // Recalculate Storage immediately!

    showSnackbar("Photos processed & staged successfully. Click 'SAVE CHANGES' to publish live!");
    btn.disabled = false;
};

// === Deletion Logic ===
window.confirmDeleteOp = (id) => {
    pendingDeleteDoc = id;
    pendingDeleteType = 'operation';
    pendingDeleteData = operationsData.find(o => o.id === id);
    openDeleteModal();
};

window.confirmDeleteGallery = (id) => {
    pendingDeleteDoc = id;
    pendingDeleteType = 'gallery';
    pendingDeleteData = galleriesData.find(g => g.id === id);
    openDeleteModal();
};

function openDeleteModal() {
    deleteConfirmInput.value = '';
    btnConfirmDelete.disabled = true;
    deleteModal.classList.add('active');
}

btnCancelDelete.onclick = () => deleteModal.classList.remove('active');

deleteConfirmInput.oninput = (e) => btnConfirmDelete.disabled = e.target.value !== 'DELETE';

btnConfirmDelete.onclick = async () => {
    btnConfirmDelete.disabled = true;
    const col = pendingDeleteType === 'operation' ? 'park_operations' : 'client_galleries';

    // Clean up Storage Files before deleting the document
    if (pendingDeleteType === 'operation' && pendingDeleteData?.hero_img_url) {
        try {
            await deleteObject(ref(storage, pendingDeleteData.hero_img_url));
        } catch (e) { console.warn("Could not delete park hero image", e); }
    } else if (pendingDeleteType === 'gallery' && pendingDeleteData) {
        // Move to backup collection in Firestore with deletedAt timestamp for the 14-day failsafe
        try {
            await setDoc(doc(db, "deleted_galleries", pendingDeleteDoc), {
                ...pendingDeleteData,
                deletedAt: serverTimestamp()
            });
        } catch (e) { console.error("Could not write deleted gallery backup document:", e); }
    }

    await deleteDoc(doc(db, col, pendingDeleteDoc));
    if (pendingDeleteType === 'operation') await loadOperations();
    deleteModal.classList.remove('active');
    hasUnsavedChanges = false; // Deletion is final
    updateLiveQuotaMetrics(true); // Recalculate Storage immediately!
    showSnackbar("Deleted Successfully", true);
};

async function performStorageCleanup() {
    try {
        const snap = await getDocs(collection(db, "deleted_galleries"));
        const now = Date.now();
        const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
        
        for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const deletedAt = data.deletedAt?.toDate ? data.deletedAt.toDate().getTime() : 0;
            if (deletedAt && (now - deletedAt > fourteenDaysMs)) {
                console.log(`Purging 14-day old gallery backup: ${data.title}`);
                // Delete cover image
                if (data.albumCover) {
                    try {
                        await deleteObject(ref(storage, data.albumCover));
                    } catch (e) { console.warn("Failed to delete backup cover", e); }
                }
                // Delete all photos in the array
                if (data.photos && Array.isArray(data.photos)) {
                    for (const photo of data.photos) {
                        const url = typeof photo === 'string' ? photo : photo.url;
                        if (url) {
                            try {
                                await deleteObject(ref(storage, url));
                            } catch (e) { console.warn("Failed to delete backup photo", e); }
                        }
                    }
                }
                // Delete backup document from Firestore
                await deleteDoc(docSnap.ref);
            }
        }
    } catch (e) {
        console.error("Error during performStorageCleanup:", e);
    }
}

// --- Generic Confirmation Helper ---
const genericConfirmModal = document.getElementById('generic-confirm-modal');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const confirmTitle = document.getElementById('confirm-title');
const confirmMsg = document.getElementById('confirm-msg');

window.confirmDeletion = (message, title = "Are you sure?") => {
    confirmTitle.textContent = title;
    confirmMsg.textContent = message;
    genericConfirmModal.classList.add('active');

    return new Promise((resolve) => {
        btnConfirmOk.onclick = () => {
            genericConfirmModal.classList.remove('active');

            // Execute the actual deletion logic
            if (pendingDeleteType === 'testimonial') {
                pendingDeleteData.element.remove();
                history.push('testimonial_delete', window.SectionStateManager['section-testimonials'].capture(), true);
                updateTestimonialsUnsavedStatus(true);
            } else if (pendingDeleteType === 'carousel_delete') {
                // handle carousel delete confirmation if needed (currently it's direct but we can add it)
            }

            resolve(true);
        };
        btnConfirmCancel.onclick = () => {
            genericConfirmModal.classList.remove('active');
            resolve(false);
        };
    });
};

// === Portal Canvas Editor Logic ===
let portalConfig = { order: [], layout: {}, locked: [] };
let selectedCanvasItem = null;

async function loadPortalConfig() {
    const docRef = doc(db, "site_config", "portal_layout");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        portalConfig = docSnap.data();
    }
    renderPortalCanvas();
}

function renderPortalCanvas() {
    // Clear only canvas items, keep guides
    Array.from(portalCanvas.querySelectorAll('.canvas-item')).forEach(el => el.remove());

    // 1. Filter out and render Placed Collections on Canvas
    const placedGalleries = galleriesData.filter(g => g.is_placed_in_mosaic !== false);
    placedGalleries.forEach((g, index) => {
        // Dynamic Insertion: If this is a brand new gallery, give it a default starting position
        if (!portalConfig.layout[g.id]) {
            portalConfig.layout[g.id] = {
                x: 50,
                y: 50 + (index * 20), // Slightly offset so they don't stack perfectly
                w: 250,
                h: 180
            };
        }

        const config = portalConfig.layout[g.id];
        const item = document.createElement('div');
        item.className = 'canvas-item';
        if (selectedCanvasItem === g.id) item.classList.add('selected');
        item.dataset.id = g.id;
        item.style.left = `${config.x}px`;
        item.style.top = `${config.y}px`;
        item.style.width = `${config.w}px`;
        item.style.height = `${config.h}px`;

        // Oversized safety check
        const isOversized = config.w > 600 || config.h > 500;
        item.classList.toggle('oversized', isOversized);

        // Robust Cover Selection
        let coverUrl = '';
        let coverObj = null;
        if (g.albumCover) {
            coverObj = g.albumCover;
            coverUrl = typeof g.albumCover === 'object' ? g.albumCover.url : g.albumCover;
        } else if (g.photos && g.photos.length > 0) {
            coverObj = g.photos[0];
            coverUrl = typeof coverObj === 'object' ? coverObj.url : coverObj;
        }

        const focal = (config && config.focal) ? config.focal : ((coverObj && typeof coverObj === 'object' && coverObj.focal) ? coverObj.focal : { x: 50, y: 50 });

        const isLocked = portalConfig.locked?.includes(g.id);
        if (isLocked) item.classList.add('locked');

        item.innerHTML = `
            <img src="${coverUrl || ''}" style="object-position: ${focal.x}% ${focal.y}%;" loading="lazy">
            <div class="lock-indicator"><i class="fas fa-lock"></i> LOCKED</div>
            <div class="canvas-overlay">
                <span style="font-size: ${Math.min(2, config.w / 150)}rem">${g.title}</span>
            </div>
            <div class="resize-handle"><i class="fas fa-expand-alt"></i></div>
        `;

        // Right Click: Toggle Lock/Unlock or Double Right Click to open focal framing editor
        let lastRightClick = 0;
        let rightClickTimeout;
        item.oncontextmenu = (e) => {
            e.preventDefault();
            const now = Date.now();
            if (item.dataset.lastRightClick && (now - parseInt(item.dataset.lastRightClick) < 300)) {
                // Double right click! Launch focal point editor
                clearTimeout(rightClickTimeout);
                item.removeAttribute('data-last-right-click');
                window.openPortalFocalEditor(g.id);
            } else {
                // First right click!
                item.dataset.lastRightClick = now;
                rightClickTimeout = setTimeout(() => {
                    item.removeAttribute('data-last-right-click');
                    if (!portalConfig.locked) portalConfig.locked = [];
                    if (portalConfig.locked.includes(g.id)) {
                        portalConfig.locked = portalConfig.locked.filter(id => id !== g.id);
                    } else {
                        portalConfig.locked.push(g.id);
                    }
                    renderPortalCanvas();
                }, 250);
            }
        };

        // Double Click to Focus for Arrow Keys (1px keyboard nudging)
        item.ondblclick = (e) => {
            e.stopPropagation();
            selectedCanvasItem = g.id;
            renderPortalCanvas();
            showSnackbar(`Keyboard Focus: ${g.title} (Arrows to Move)`);
        };

        // Drag to Reposition
        item.onpointerdown = (e) => {
            if (e.button !== 0) return; // Only main button clicks

            if (portalConfig.locked?.includes(g.id)) return;
            if (e.target.classList.contains('resize-handle')) return;

            e.preventDefault();
            item.setPointerCapture(e.pointerId);
            const zoom = parseFloat(document.getElementById('canvas-zoom').value) || 1;
            const startX = e.pageX;
            const startY = e.pageY;
            const initialX = config.x;
            const initialY = config.y;

            const onPointerMove = (moveEvt) => {
                const dx = (moveEvt.pageX - startX) / zoom;
                const dy = (moveEvt.pageY - startY) / zoom;
                config.x = initialX + dx;
                config.y = initialY + dy;
                item.style.left = `${config.x}px`;
                item.style.top = `${config.y}px`;
            };

            const onPointerUp = (upEvt) => {
                try { item.releasePointerCapture(upEvt.pointerId); } catch (err) { }
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                // Capture state for undo after a drag is finished
                history.push('portal_drag', { portalConfig });
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        };

        // Resize Logic
        const handle = item.querySelector('.resize-handle');
        handle.onpointerdown = (e) => {
            if (portalConfig.locked?.includes(g.id)) return;
            e.stopPropagation();
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);

            const zoom = parseFloat(document.getElementById('canvas-zoom').value) || 1;
            const startX = e.pageX;
            const startY = e.pageY;
            const startW = config.w;
            const startH = config.h;

            const onPointerMove = (moveEvt) => {
                const dw = (moveEvt.pageX - startX) / zoom;
                const dh = (moveEvt.pageY - startY) / zoom;

                config.w = Math.max(100, startW + dw);
                config.h = Math.max(80, startH + dh);

                item.style.width = `${config.w}px`;
                item.style.height = `${config.h}px`;

                // Oversized safety check
                const isOversized = config.w > 600 || config.h > 500;
                item.classList.toggle('oversized', isOversized);

                const titleSpan = item.querySelector('.canvas-overlay span');
                titleSpan.style.fontSize = `${Math.min(2, config.w / 150)}rem`;
            };

            const onPointerUp = (upEvt) => {
                try { handle.releasePointerCapture(upEvt.pointerId); } catch (err) { }
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
            };

            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        };

        portalCanvas.appendChild(item);
    });

    // 2. Render Unplaced Collections in the Sidebar holding dock
    const unplacedList = document.getElementById('unplaced-albums-list');
    if (unplacedList) {
        unplacedList.innerHTML = '';
        const unplacedGalleries = galleriesData.filter(g => g.is_placed_in_mosaic === false);

        if (unplacedGalleries.length === 0) {
            unplacedList.innerHTML = `<p style="font-size: 0.8rem; opacity: 0.5; text-align: center; margin-top: 1rem; color: #aaa;">No unplaced collections</p>`;
        }

        unplacedGalleries.forEach(g => {
            const div = document.createElement('div');
            div.className = 'unplaced-album-item';
            div.dataset.id = g.id;
            div.style = "background: #2b2b2b; border: 1px solid #444; border-radius: 8px; padding: 0.5rem; display: flex; align-items: center; gap: 0.8rem; cursor: grab; user-select: none; transition: transform 0.2s, border-color 0.2s;";

            let coverUrl = '';
            if (g.albumCover) {
                coverUrl = typeof g.albumCover === 'object' ? g.albumCover.url : g.albumCover;
            } else if (g.photos && g.photos.length > 0) {
                const firstPhoto = g.photos[0];
                coverUrl = typeof firstPhoto === 'object' ? firstPhoto.url : firstPhoto;
            }

            div.innerHTML = `
                <img src="${coverUrl || ''}" style="width: 45px; height: 45px; object-fit: cover; border-radius: 4px; background: #000;">
                <div style="flex-grow: 1; overflow: hidden; text-align: left;">
                    <div style="font-size: 0.8rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: white;">${g.title}</div>
                    <div style="font-size: 0.65rem; opacity: 0.5; color: #bbb;">${g.photos?.length || 0} Photos</div>
                </div>
            `;

            // Drag and drop setup
            div.draggable = true;
            div.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', g.id);
                div.style.opacity = '0.5';
            };
            div.ondragend = () => {
                div.style.opacity = '1';
            };

            unplacedList.appendChild(div);
        });
    }
}

// Zoom Logic
const zoomInput = document.getElementById('canvas-zoom');
const zoomLabel = document.getElementById('zoom-label');
if (zoomInput) {
    zoomInput.oninput = (e) => {
        const val = e.target.value;
        portalCanvas.style.transform = `scale(${val})`;
        zoomLabel.textContent = `${Math.round(val * 100)}%`;
    };
}

// Deselect on Canvas Click
if (portalCanvas) {
    portalCanvas.onclick = (e) => {
        const targetId = e.target.id;
        if (targetId === 'portal-canvas') {
            selectedCanvasItem = null;
            renderPortalCanvas();
        } else if (targetId === 'section-portal-canvas') {
            renderPortalCanvas();
        } else if (targetId === 'section-podcast') {
            loadSubtitles();
        }
    };

    portalCanvas.ondragover = (e) => {
        e.preventDefault();
    };

    portalCanvas.ondrop = (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        const g = galleriesData.find(item => item.id === id);
        if (!g) return;

        // Calculate drop coordinates relative to portalCanvas
        const rect = portalCanvas.getBoundingClientRect();
        const zoom = parseFloat(document.getElementById('canvas-zoom').value) || 1;

        const x = Math.round((e.clientX - rect.left) / zoom);
        const y = Math.round((e.clientY - rect.top) / zoom);

        // Initialize layout centered on dropped point
        portalConfig.layout[g.id] = {
            x: Math.max(0, x - 125),
            y: Math.max(0, y - 90),
            w: 250,
            h: 180
        };

        // Flip internal flag to placed
        g.is_placed_in_mosaic = true;

        // Mark as unsaved changes
        hasUnsavedChanges = true;

        // Push state to history
        history.push('portal_dock_placement', window.SectionStateManager['section-portal-canvas'].capture(), true);

        // Re-render
        renderPortalCanvas();
        showSnackbar(`Collection "${g.title}" placed on the canvas grid!`);
    };
}

// Global Arrow Key Nudge
document.addEventListener('keydown', (e) => {
    // Ignore keydown nudges if typing in any text input/textarea!
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (!selectedCanvasItem) return;

    const config = portalConfig.layout[selectedCanvasItem];
    if (!config) return;

    const step = e.shiftKey ? 10 : 1; // Nudge by 10px if shift is held
    let changed = false;

    if (e.key === 'ArrowLeft') { config.x -= step; changed = true; }
    if (e.key === 'ArrowRight') { config.x += step; changed = true; }
    if (e.key === 'ArrowUp') { config.y -= step; changed = true; }
    if (e.key === 'ArrowDown') { config.y += step; changed = true; }

    if (changed) {
        e.preventDefault();
        const item = portalCanvas.querySelector(`.canvas-item[data-id="${selectedCanvasItem}"]`);
        if (item) {
            item.style.left = `${config.x}px`;
            item.style.top = `${config.y}px`;
        }
        // Capture for Undo (batched)
        history.push('portal_nudge', { portalConfig });
    }
});

btnSaveCanvas.onclick = async () => {
    btnSaveCanvas.disabled = true;
    const originalText = btnSaveCanvas.textContent;
    btnSaveCanvas.textContent = "Saving Layout...";

    try {
        // 3. Automatic Cleanup: Prune layout data for galleries that no longer exist
        const activeIds = galleriesData.map(g => g.id);
        const prunedLayout = {};

        activeIds.forEach(id => {
            if (portalConfig.layout[id]) {
                prunedLayout[id] = portalConfig.layout[id];
            }
        });

        portalConfig.layout = prunedLayout;

        // Write the layout configuration
        await setDoc(doc(db, "site_config", "portal_layout"), portalConfig);

        // Write the is_placed_in_mosaic flag for all galleries in Firestore
        for (const g of galleriesData) {
            await setDoc(doc(db, "client_galleries", g.id), {
                is_placed_in_mosaic: g.is_placed_in_mosaic !== false
            }, { merge: true });
        }

        hasUnsavedChanges = false;
        saveSectionSnapshot('section-portal-canvas');
        history.clear();
        showSnackbar("Portal Layout & placements successfully saved!");
    } catch (err) {
        console.error("Canvas Save Error:", err);
        showSnackbar("Failed to save layout: " + err.message);
    } finally {
        btnSaveCanvas.disabled = false;
        btnSaveCanvas.textContent = originalText;
    }
};

// === Utils ===
function generateSlug(text) { return text.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, ''); }

function showSnackbar(msg, undoable = false) {
    snackbarText.textContent = msg;
    if (btnUndo) btnUndo.style.display = undoable ? 'block' : 'none';
    snackbar.style.display = 'flex';
    clearTimeout(undoTimeout);
    undoTimeout = setTimeout(() => snackbar.style.display = 'none', 5000);
}

// === Cheat Sheet & Global Controls Initialization ===
document.addEventListener('DOMContentLoaded', () => {
    const btnOpenCheat = document.getElementById('btn-open-cheat-sheet');
    const btnCloseCheat = document.getElementById('btn-close-cheat-sheet');
    const cheatModal = document.getElementById('cheat-sheet-modal');
    const btnGlobalUndo = document.getElementById('btn-global-undo');
    const btnGlobalRedo = document.getElementById('btn-global-redo');

    if (btnOpenCheat) {
        btnOpenCheat.onclick = () => cheatModal.classList.add('active');
    }
    if (btnCloseCheat) {
        btnCloseCheat.onclick = () => cheatModal.classList.remove('active');
    }
    if (cheatModal) {
        cheatModal.onclick = (e) => {
            if (e.target === cheatModal) cheatModal.classList.remove('active');
        };
    }

    if (btnGlobalUndo) {
        btnGlobalUndo.onclick = () => history.undo(() => ({ portalConfig, existingGalleryPhotos, currentTemplate, albumCoverUrl, heroImageUrl }));
    }
    if (btnGlobalRedo) {
        btnGlobalRedo.onclick = () => history.redo(() => ({ portalConfig, existingGalleryPhotos, currentTemplate, albumCoverUrl, heroImageUrl }));
    }

    // Global Key Listener for Undo/Redo
    document.addEventListener('keydown', (e) => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

        if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'z') {
                e.preventDefault();
                history.undo(() => ({ portalConfig, existingGalleryPhotos, currentTemplate, albumCoverUrl, heroImageUrl }));
            }
            if (e.key.toLowerCase() === 'y') {
                e.preventDefault();
                history.redo(() => ({ portalConfig, existingGalleryPhotos, currentTemplate, albumCoverUrl, heroImageUrl }));
            }
        }
    });
});
// === Podcast Subtitles ===
window.importWhisperData = () => {
    let input = document.getElementById('whisper-input').value;
    if (!input) return;

    // Remove HTML tags
    input = input.replace(/<[^>]*>?/gm, '');

    const lines = input.split('\n');
    subtitleList.innerHTML = '';

    lines.forEach(line => {
        // Match timestamps like 00:00:00,539 or 00:05.000
        const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})/g);
        if (timeMatch && timeMatch.length >= 2) {
            const start = timeMatch[0].replace(',', '.');
            const end = timeMatch[1].replace(',', '.');

            // Look for text in the NEXT line of the array if it's empty here
            const currentIdx = lines.indexOf(line);
            let text = lines[currentIdx + 1] || '';

            // Clean text: remove [speaker_X] and trim
            text = text.replace(/\[speaker_\d+\]/gi, '').trim();

            if (text) window.addSubtitleLine(start, end, text);
        }
    });
    showSnackbar("Magic Import: Cleaned & Synced");
};

window.chopLongLines = () => {
    const rows = subtitleList.querySelectorAll('.subtitle-row');
    const newLines = [];

    rows.forEach(row => {
        const startStr = row.querySelector('.sub-start').value;
        const endStr = row.querySelector('.sub-end').value;
        const text = row.querySelector('.sub-text').value;

        // Only chop if more than ~60 chars (approx 1 line)
        if (text.length > 60) {
            const words = text.split(' ');
            const chunks = [];
            let currentChunk = [];

            words.forEach(word => {
                currentChunk.push(word);
                if (currentChunk.join(' ').length > 50) {
                    chunks.push(currentChunk.join(' '));
                    currentChunk = [];
                }
            });
            if (currentChunk.length > 0) chunks.push(currentChunk.join(' '));

            // Interpolate timing
            const startSec = parseTimeToSec(startStr);
            const endSec = parseTimeToSec(endStr);
            const duration = endSec - startSec;
            const chunkDuration = duration / chunks.length;

            chunks.forEach((chunk, i) => {
                const s = formatSecToTime(startSec + (i * chunkDuration));
                const e = formatSecToTime(startSec + ((i + 1) * chunkDuration));
                newLines.push({ start: s, end: e, text: chunk });
            });
        } else {
            newLines.push({ start: startStr, end: endStr, text: text });
        }
    });

    subtitleList.innerHTML = '';
    newLines.forEach(l => window.addSubtitleLine(l.start, l.end, l.text));
    showSnackbar("Lines Chopped for 1-Line Mode");
};

function parseTimeToSec(t) {
    const parts = t.split(':').map(parseFloat);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    return parts[0] || 0;
}

function formatSecToTime(s) {
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = (s % 60).toFixed(3);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(6, '0')}`;
}

window.addSubtitleLine = (start = '', end = '', text = '', pushToHistory = false) => {
    const div = document.createElement('div');
    div.className = 'subtitle-row';
    div.style = "display: flex; gap: 0.5rem; margin-bottom: 0.8rem; align-items: center; background: #fff; padding: 0.5rem; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);";
    div.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="text" class="sub-start" placeholder="00:00" value="${start}" style="width: 85px; font-size: 0.8rem;">
                <button type="button" onclick="nudge(this, -0.1)" style="padding: 2px 5px; font-size: 0.7rem;">-</button>
                <button type="button" onclick="nudge(this, 0.1)" style="padding: 2px 5px; font-size: 0.7rem;">+</button>
            </div>
            <div style="display: flex; align-items: center; gap: 4px;">
                <input type="text" class="sub-end" placeholder="00:05" value="${end}" style="width: 85px; font-size: 0.8rem;">
                <button type="button" onclick="nudge(this, -0.1)" style="padding: 2px 5px; font-size: 0.7rem;">-</button>
                <button type="button" onclick="nudge(this, 0.1)" style="padding: 2px 5px; font-size: 0.7rem;">+</button>
            </div>
        </div>
        <textarea class="sub-text" placeholder="Subtitle text..." style="flex-grow: 1; height: 45px; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9rem;">${text}</textarea>
        <button type="button" class="remove-subtitle-btn" style="color:#ff6b6b; background:none; border:none; cursor:pointer; font-size: 1.2rem;">&times;</button>
    `;
    div.querySelector('.remove-subtitle-btn').onclick = () => {
        div.remove();
        hasUnsavedChanges = true;
        history.push('subtitle_delete', window.SectionStateManager['section-podcast'].capture(), true);
    };
    subtitleList.appendChild(div);

    if (pushToHistory) {
        hasUnsavedChanges = true;
        history.push('subtitle_add', window.SectionStateManager['section-podcast'].capture(), true);
    }
};

window.nudge = (btn, amount) => {
    const input = btn.parentElement.querySelector('input');
    const current = parseTimeToSec(input.value);
    input.value = formatSecToTime(Math.max(0, current + amount));
};

// Admin Audio Tracking
const adminAudio = document.getElementById('admin-audio-preview');
const adminAudioTime = document.getElementById('admin-audio-time');
if (adminAudio) {
    adminAudio.ontimeupdate = () => {
        adminAudioTime.textContent = formatSecToTime(adminAudio.currentTime);
    };
}

async function loadSubtitles() {
    subtitleList.innerHTML = '';
    const docSnap = await getDoc(doc(db, "site_config", "podcast_subtitles"));
    if (docSnap.exists()) {
        const lines = docSnap.data().lines || [];
        lines.forEach(l => window.addSubtitleLine(l.start, l.end, l.text));
    }
    if (subtitleList.children.length === 0) window.addSubtitleLine();
}

btnSaveSubtitles.onclick = async () => {
    const rows = subtitleList.querySelectorAll('.subtitle-row');
    const lines = Array.from(rows).map(row => ({
        start: row.querySelector('.sub-start').value,
        end: row.querySelector('.sub-end').value,
        text: row.querySelector('.sub-text').value
    }));

    try {
        await setDoc(doc(db, "site_config", "podcast_subtitles"), { lines });
        hasUnsavedChanges = false;

        // Generate VTT file content
        let vttContent = "WEBVTT\n\n";
        lines.forEach(l => {
            if (l.start && l.end && l.text) {
                // Format: 00:00.000 --> 00:05.000
                const s = l.start.includes('.') ? l.start : l.start + ".000";
                const e = l.end.includes('.') ? l.end : l.end + ".000";
                vttContent += `${s} --> ${e}\n${l.text}\n\n`;
            }
        });

        // Save VTT to Firestore for direct access (or Storage if preferred, but for now simple sync)
        await setDoc(doc(db, "site_config", "podcast_vtt"), { content: vttContent });

        hasUnsavedChanges = false;
        saveSectionSnapshot('section-podcast');
        history.clear();
        showSnackbar("Subtitles Synced Successfully");
    } catch (err) {
        console.error(err);
        showSnackbar("Error saving subtitles");
    }
};

/**
 * Centralized Image Washing & Compression Function
 * 1. Strips all EXIF/metadata (by redrawing to canvas)
 * 2. Compresses to JPEG
 * 3. Optionally resizes if maxDimension is provided
 */
async function washImage(file, maxDimension = null, quality = 0.85) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;

                if (maxDimension) {
                    if (w > h) {
                        if (w > maxDimension) { h *= maxDimension / w; w = maxDimension; }
                    } else {
                        if (h > maxDimension) { w *= maxDimension / h; h = maxDimension; }
                    }
                }

                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);

                // Convert to blob
                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                }, 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// === Guide Profile Logic ===
async function initGuideProfileManager() {
    const introTitleEl = document.getElementById('guide-intro-title');
    const introEl = document.getElementById('guide-intro-input');
    const footerQuoteEl = document.getElementById('guide-footer-quote-input');
    const factsContainer = document.getElementById('dynamic-key-facts');
    const addFactBtn = document.getElementById('add-key-fact-btn');
    const careerTitleEl = document.getElementById('guide-career-title');
    const careerTextEl = document.getElementById('guide-career-input');
    const consTitleEl = document.getElementById('guide-conservation-title');
    const consTextEl = document.getElementById('guide-conservation-input');
    const recTitleEl = document.getElementById('guide-recognition-title');
    const recTextEl = document.getElementById('guide-recognition-input');
    const customContainer = document.getElementById('custom-bio-sections');
    const addBioBtn = document.getElementById('add-bio-section-btn');
    const restoreBtn = document.getElementById('restore-guide-defaults-btn');

    if (!introEl) return;

    const defaultData = {
        intro: "Dean McGregor is an experienced Zimbabwean Professional Guide with a deep passion for the African bush and its wildlife. Having led safaris throughout Zimbabwe’s iconic national parks and wilderness areas, Dean is known for his exceptional knowledge, calm professionalism, and engaging guiding style.\n\nBlending storytelling, humour, and insight, Dean creates authentic safari experiences that are both informative and unforgettable — whether tracking wildlife on foot, birding, or sharing stories around the campfire. Through Dean McGregor Safaris, he offers guests a genuine connection to Zimbabwe’s landscapes, wildlife, and wild spirit.",
        facts: [
            { label: "Profession", value: "Safari guide and field naturalist" },
            { label: "Location", value: "Zimbabwe, southern Africa" },
            { label: "Expertise", value: "Wildlife tracking, conservation guiding, and eco-tourism leadership" },
            { label: "Special Focus", value: "Walking safaris and photographic wildlife expeditions" }
        ],
        sections: [
            { id: "career", title: "Career & Guiding Work", text: "McGregor has established himself as part of Zimbabwe’s tradition of highly qualified, licensed professional guides — a group recognized among the most rigorously trained in Africa. His guiding career has included leading safaris through diverse ecosystems such as Hwange National Park, Mana Pools, and the Zambezi Valley. His approach combines ecological interpretation, animal tracking, and safety in big game terrain to deliver educational, conservation-centered safari experiences." },
            { id: "conservation", title: "Conservation & Philosophy", text: "Beyond guiding, McGregor advocates for low-impact tourism as a tool for wildlife conservation and community development. He works with conservation programs that support anti-poaching initiatives and habitat protection, encouraging guests to understand their role in sustaining Africa’s natural heritage. His ethos aligns with the broader Zimbabwean guiding culture of fostering respect for wildlife and ecological balance through first-hand experience in the field." },
            { id: "recognition", title: "Recognition & Influence", text: "Within the guiding community, Dean McGregor is noted for his professionalism and mentorship of trainee guides. His safaris emphasize ethical wildlife encounters, cultural engagement with local communities, and the preservation of wilderness skills that keep Zimbabwe a leading destination for authentic, conservation-driven safari travel." }
        ],
        image_urls: [
            "https://images.unsplash.com/photo-1516422317184-268a44c3d05b?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1547407139-3c921a66005c?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1511497584788-8767fe78e726?auto=format&fit=crop&q=80&w=800"
        ]
    };

    // Local state to keep track of current URLs
    let currentHeroUrl = "";
    let currentImageUrls = [];

    const populateUI = (data) => {
        if (introTitleEl) introTitleEl.value = data.intro_title || "";
        introEl.value = data.intro || "";
        if (footerQuoteEl) footerQuoteEl.value = data.footer_quote || "";

        factsContainer.innerHTML = '';
        (data.facts || []).forEach(f => createKeyFactUI(f.label, f.value));

        const sections = data.sections || [];
        const career = sections.find(s => s.id === "career") || { title: "Career & Guiding Work", text: "" };
        careerTitleEl.value = career.title;
        careerTextEl.value = career.text || data.career || "";

        const conservation = sections.find(s => s.id === "conservation") || { title: "Conservation & Philosophy", text: "" };
        consTitleEl.value = conservation.title;
        consTextEl.value = conservation.text || data.conservation || "";

        const recognition = sections.find(s => s.id === "recognition") || { title: "Recognition & Influence", text: "" };
        recTitleEl.value = recognition.title;
        recTextEl.value = recognition.text || data.recognition || "";

        customContainer.innerHTML = '';
        sections.filter(s => !["career", "conservation", "recognition"].includes(s.id)).forEach(s => {
            createCustomSectionUI(s.title, s.text);
        });

        // Update Previews
        currentHeroUrl = data.hero_image_url || "";
        currentImageUrls = data.image_urls || [];

        const updatePreview = (container, url) => {
            if (url) container.innerHTML = `<img src="${url}" style="width: 100%; height: 100%; object-fit: cover;">`;
            else container.innerHTML = `<span style="opacity: 0.3;">No Image</span>`;
        };

        updatePreview(guideHeroPreview, currentHeroUrl);
        updatePreview(guideImg0Preview, currentImageUrls[0]);
        updatePreview(guideImg1Preview, currentImageUrls[1]);
        updatePreview(guideImg2Preview, currentImageUrls[2]);
    };

    // Instant Preview Listeners
    const setupInstantPreview = (input, container) => {
        if (!input || !container) return;
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    container.innerHTML = `<img src="${re.target.result}" style="width: 100%; height: 100%; object-fit: cover; border: 2px solid var(--accent-gold);">`;
                };
                reader.readAsDataURL(file);
            }
        });
    };

    setupInstantPreview(guideHeroInput, guideHeroPreview);
    setupInstantPreview(guideImg0Input, guideImg0Preview);
    setupInstantPreview(guideImg1Input, guideImg1Preview);
    setupInstantPreview(guideImg2Input, guideImg2Preview);


    addBioBtn.onclick = () => {
        createCustomSectionUI();
        hasUnsavedChanges = true;
        history.push('guide_section_add', window.SectionStateManager['section-guide'].capture(), true);
    };
    addFactBtn.onclick = () => {
        createKeyFactUI();
        hasUnsavedChanges = true;
        history.push('guide_fact_add', window.SectionStateManager['section-guide'].capture(), true);
    };
    // Restore button removed from UI — handler kept inert to avoid null errors
    if (restoreBtn) {
        restoreBtn.onclick = () => {
            if (confirm("This will overwrite your current inputs with the professional copy. Continue?")) {
                populateUI(defaultData);
                hasUnsavedChanges = true;
            }
        };
    }

    const profileRef = doc(db, "guide_profile", "dean");
    const docSnap = await getDoc(profileRef);

    if (docSnap.exists()) {
        const data = docSnap.data();

        // Robust Migration
        if ((!data.facts || data.facts.length === 0) && data.profession) {
            data.facts = [
                { label: "Profession", value: data.profession },
                { label: "Location", value: data.location || "" },
                { label: "Expertise", value: data.expertise || "" },
                { label: "Special Focus", value: data.focus || "" }
            ];
        }
        if (!data.sections || data.sections.length === 0) {
            data.sections = [
                { id: "career", title: "Career & Guiding Work", text: data.career || "" },
                { id: "conservation", title: "Conservation & Philosophy", text: data.conservation || "" },
                { id: "recognition", title: "Recognition & Influence", text: data.recognition || "" }
            ];
        }

        const hasAnyData = data.intro || (data.facts && data.facts.length > 0) || (data.sections && data.sections.some(s => s.text));
        if (!hasAnyData) populateUI(defaultData);
        else populateUI(data);
    } else {
        populateUI(defaultData);
    }

    const form = document.getElementById('guide-profile-form');
    form.onsubmit = async (e) => {
        e.preventDefault();
        const saveBtn = e.target.querySelector('button[type="submit"]');
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            const finalFacts = [];
            document.querySelectorAll('.key-fact-row').forEach(row => {
                const label = row.querySelector('.fact-label').value;
                const value = row.querySelector('.fact-value').value;
                if (label || value) finalFacts.push({ label, value });
            });

            // Smart-hide: only include core sections that have at least a title or text
            const sections = [
                { id: "career", title: careerTitleEl.value, text: careerTextEl.value },
                { id: "conservation", title: consTitleEl.value, text: consTextEl.value },
                { id: "recognition", title: recTitleEl.value, text: recTextEl.value }
            ].filter(s => s.title.trim() || s.text.trim());

            document.querySelectorAll('.custom-bio-group').forEach((group, index) => {
                const title = group.querySelector('.custom-title').value;
                const text = group.querySelector('.custom-text').value;
                if (title || text) sections.push({ id: `custom-${index}`, title, text });
            });

            const updateData = {
                intro_title: introTitleEl ? introTitleEl.value : "",
                intro: introEl.value,
                footer_quote: footerQuoteEl ? footerQuoteEl.value : "",
                facts: finalFacts,
                sections: sections,
                updated_at: serverTimestamp()
            };

            // Handle Individual Image Uploads
            // 1. Hero Image
            if (guideHeroInput.files.length > 0) {
                const washed = await washImage(guideHeroInput.files[0]);
                const storageRef = ref(storage, `guide_profile/hero_${Date.now()}`);
                const snapshot = await uploadBytes(storageRef, washed);
                
                // Cleanup: Delete the old hero image via server (Admin SDK bypasses rules)
                await deleteStorageFileViaServer(currentHeroUrl);
                
                updateData.hero_image_url = await getDownloadURL(snapshot.ref);
            }

            // 2. Triptych/Diptych Images (0, 1, 2)
            const newImageUrls = [...currentImageUrls];
            const imageInputs = [guideImg0Input, guideImg1Input, guideImg2Input];

            for (let i = 0; i < 3; i++) {
                if (imageInputs[i].files.length > 0) {
                    const washed = await washImage(imageInputs[i].files[0]);
                    const storageRef = ref(storage, `guide_profile/dean_img_${Date.now()}_${i}`);
                    const snapshot = await uploadBytes(storageRef, washed);
                    
                    // Cleanup: Delete the old image at index i via server (Admin SDK bypasses rules)
                    await deleteStorageFileViaServer(currentImageUrls[i]);
                    
                    newImageUrls[i] = await getDownloadURL(snapshot.ref);
                }
            }
            updateData.image_urls = newImageUrls;


            await setDoc(profileRef, updateData, { merge: true });

            // Clear inputs
            [guideHeroInput, guideImg0Input, guideImg1Input, guideImg2Input].forEach(inp => inp.value = '');

            hasUnsavedChanges = false;
            saveSectionSnapshot('section-guide');
            history.clear();
            updateLiveQuotaMetrics(true); // Recalculate Storage immediately!
            alert("Guide profile updated successfully!");

            // Update local state and UI
            if (updateData.hero_image_url) currentHeroUrl = updateData.hero_image_url;
            currentImageUrls = updateData.image_urls;
        } catch (error) {
            console.error("Error saving profile:", error);
            alert("Failed to save profile.");
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Profile Updates";
        }
    };
}

function createKeyFactUI(label = "", value = "") {
    const container = document.getElementById('dynamic-key-facts');
    const row = document.createElement('div');
    row.className = "key-fact-row";
    row.style = "display: grid; grid-template-columns: 1fr 2fr auto; gap: 1rem; align-items: flex-end; margin-bottom: 1rem; padding: 0.75rem; background: rgba(0,0,0,0.01); border-radius: 6px;";
    row.innerHTML = `
        <div class="form-group" style="margin-bottom: 0;">
            <label style="font-size: 0.7rem;">Label</label>
            <input type="text" class="fact-label" value="${label}">
        </div>
        <div class="form-group" style="margin-bottom: 0;">
            <label style="font-size: 0.7rem;">Value</label>
            <input type="text" class="fact-value" value="${value}">
        </div>
        <button type="button" class="remove-fact-btn" style="background: none; border: none; color: #ff4444; cursor: pointer;">✕</button>
    `;
    row.querySelector('.remove-fact-btn').onclick = () => {
        row.remove();
        hasUnsavedChanges = true;
        history.push('guide_fact_delete', window.SectionStateManager['section-guide'].capture(), true);
    };
    container.appendChild(row);
}

function createCustomSectionUI(title = "", text = "") {
    const container = document.getElementById('custom-bio-sections');
    const group = document.createElement('div');
    group.className = "custom-bio-group";
    group.style = "margin-bottom: 2rem; padding: 1.5rem; background: rgba(227, 168, 87, 0.05); border: 1px solid var(--glass-border); border-radius: 8px; position: relative;";
    group.innerHTML = `
        <button type="button" class="remove-btn" style="position: absolute; top: 10px; right: 10px; background: none; border: none; color: #ff4444; cursor: pointer; font-size: 0.8rem;">Remove</button>
        <div class="form-group">
            <label>Subheading</label>
            <input type="text" class="custom-title" value="${title}">
        </div>
        <div class="form-group">
            <label>Text Content</label>
            <textarea class="custom-text" rows="4">${text}</textarea>
        </div>
    `;
    group.querySelector('.remove-btn').onclick = () => {
        group.remove();
        hasUnsavedChanges = true;
        history.push('guide_section_delete', window.SectionStateManager['section-guide'].capture(), true);
    };
    container.appendChild(group);
}


// === Helper to toggle/apply bolding in any textarea/input field ===
function applyBoldToSelection(inputEl) {
    const start = inputEl.selectionStart;
    const end = inputEl.selectionEnd;
    const value = inputEl.value;
    const selectedText = value.substring(start, end);

    let newValue;
    let newStart;
    let newEnd;

    if (selectedText.startsWith('**') && selectedText.endsWith('**')) {
        // Unwrap bold
        const unwrapped = selectedText.slice(2, -2);
        newValue = value.substring(0, start) + unwrapped + value.substring(end);
        newStart = start;
        newEnd = start + unwrapped.length;
    } else {
        // Wrap bold
        newValue = value.substring(0, start) + '**' + selectedText + '**' + value.substring(end);
        newStart = start + 2;
        newEnd = end + 2;
    }

    inputEl.value = newValue;
    inputEl.focus();
    inputEl.setSelectionRange(newStart, newEnd);

    // Trigger input event to update hasUnsavedChanges and SectionStateManager!
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
}

// === Global Keyboard Shortcuts (Undo/Redo & Save) ===
document.addEventListener('keydown', (e) => {
    const hasModifier = e.ctrlKey || e.metaKey; // Accept either — covers Windows, Mac, and Mac keyboards on Windows

    if (!hasModifier) return; // Only process Modifier keybinds here

    const key = e.key.toLowerCase();

    // 1. Save: Modifier + S
    if (key === 's') {
        e.preventDefault();

        // If currently typing inside a form, trigger that form's submit
        const activeForm = document.activeElement ? document.activeElement.closest('form') : null;
        if (activeForm) {
            if (typeof activeForm.requestSubmit === 'function') {
                activeForm.requestSubmit();
            } else {
                activeForm.dispatchEvent(new Event('submit', { cancelable: true }));
            }
            return;
        }

        // Otherwise, check active section and trigger appropriate button clicks
        const sectionId = history.activeSection;
        if (!sectionId) return;

        const activeSecEl = document.getElementById(sectionId);
        if (!activeSecEl) return;

        // If there's an active visible modal like focal adjuster, close/save it
        if (typeof activeFocalIndex !== 'undefined' && activeFocalIndex !== null) {
            const btn = document.getElementById('btn-save-focal');
            if (btn) { btn.click(); return; }
        }
        if (typeof activeGalleryFocalIndex !== 'undefined' && activeGalleryFocalIndex !== null) {
            const btn = document.getElementById('btn-save-gallery-focal');
            if (btn) { btn.click(); return; }
        }
        if (typeof activeHeroFocalIndex !== 'undefined' && activeHeroFocalIndex !== null) {
            const btn = document.getElementById('btn-save-hero-focal');
            if (btn) { btn.click(); return; }
        }

        // Search for relevant save buttons inside the active section
        if (sectionId === 'section-operations') {
            const btn = document.getElementById('btn-save-all-park-info') || document.getElementById('btn-save-all-schematics');
            if (btn) { btn.click(); return; }
        }
        if (sectionId === 'section-testimonials') {
            const btn = document.getElementById('btn-save-testimonials-action') || document.getElementById('btn-save-testimonials-bottom');
            if (btn) { btn.click(); return; }
        }
        if (sectionId === 'section-home-carousel') {
            const btn = document.getElementById('btn-save-carousel-order') || document.getElementById('btn-save-carousel-bottom');
            if (btn) { btn.click(); return; }
        }
        if (sectionId === 'section-gallery') {
            const btn = document.getElementById('btn-save-gallery-layout') || document.getElementById('btn-save-uploads') || document.getElementById('btn-save-gallery-order-global');
            if (btn) { btn.click(); return; }
        }
        if (sectionId === 'section-portal-canvas') {
            const btn = document.getElementById('btn-save-canvas');
            if (btn) { btn.click(); return; }
        }
        if (sectionId === 'section-guide') {
            // Explicitly submit the guide profile form — avoids hitting file-upload buttons
            const form = document.getElementById('guide-profile-form');
            if (form) {
                if (typeof form.requestSubmit === 'function') { form.requestSubmit(); }
                else { form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
            }
            return;
        }
        if (sectionId === 'section-podcast') {
            const btn = document.getElementById('btn-save-subtitles');
            if (btn) { btn.click(); return; }
        }

        // Default: Find first SUBMIT button in the active section (never type="button" — those open file dialogs)
        const firstSubmit = activeSecEl.querySelector('button[type="submit"]');
        if (firstSubmit) {
            firstSubmit.click();
        }
        return;
    }

    // 2. Undo: Modifier + Z (works while focused inside inputs/textareas too!)
    if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const section = history.activeSection;
        history.undo(() => window.SectionStateManager[section] ? window.SectionStateManager[section].capture() : null);
        return;
    }

    // 3. Redo: Modifier + Y or Modifier + Shift + Z
    if (key === 'y' || (e.shiftKey && key === 'z')) {
        e.preventDefault();
        const section = history.activeSection;
        history.redo(() => window.SectionStateManager[section] ? window.SectionStateManager[section].capture() : null);
        return;
    }

    // 4. Bold Selection: Modifier + B (works inside inputs & textareas)
    if (key === 'b') {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            e.preventDefault();
            applyBoldToSelection(activeEl);
            return;
        }
    }

    // 5. Fresh Paragraph: Modifier + Enter (inside Textareas only)
    if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'TEXTAREA') {
            e.preventDefault();
            const start = activeEl.selectionStart;
            const end = activeEl.selectionEnd;
            const val = activeEl.value;
            activeEl.value = val.substring(0, start) + '\n\n' + val.substring(end);
            activeEl.focus();
            activeEl.setSelectionRange(start + 2, start + 2);
            activeEl.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
    }
});

// === Global Undo/Redo Button Click Handlers ===
const globalUndoBtn = document.getElementById('btn-global-undo');
if (globalUndoBtn) {
    globalUndoBtn.onclick = () => {
        const section = history.activeSection;
        history.undo(() => window.SectionStateManager[section] ? window.SectionStateManager[section].capture() : null);
    };
}

const globalRedoBtn = document.getElementById('btn-global-redo');
if (globalRedoBtn) {
    globalRedoBtn.onclick = () => {
        const section = history.activeSection;
        history.redo(() => window.SectionStateManager[section] ? window.SectionStateManager[section].capture() : null);
    };
}

// Testimonials Undo/Redo
const testUndoBtn = document.getElementById('btn-testimonials-undo');
if (testUndoBtn) {
    testUndoBtn.onclick = () => {
        history.undo(() => window.SectionStateManager['section-testimonials'].capture());
    };
}
const testRedoBtn = document.getElementById('btn-testimonials-redo');
if (testRedoBtn) {
    testRedoBtn.onclick = () => {
        history.redo(() => window.SectionStateManager['section-testimonials'].capture());
    };
}

// Gallery Undo/Redo
const galUndoBtn = document.getElementById('btn-gallery-undo');
if (galUndoBtn) {
    galUndoBtn.onclick = () => {
        history.undo(() => window.SectionStateManager['section-gallery'].capture());
    };
}
const galRedoBtn = document.getElementById('btn-gallery-redo');
if (galRedoBtn) {
    galRedoBtn.onclick = () => {
        history.redo(() => window.SectionStateManager['section-gallery'].capture());
    };
}

// === Usage & Analytics Dashboard Logic ===
let trafficChartInstance = null;
let devicesChartInstance = null;
let interactionsChartInstance = null;

let isStorageScanning = false;
let cachedStorageBytes = 0; // Initialize at 0 instead of stale baseline

async function calculateRealStorageSpace() {
    const rootRef = ref(storage);
    let totalBytes = 0;

    async function traverse(folderRef) {
        const res = await listAll(folderRef);

        // Sum files in this folder
        const sizePromises = res.items.map(async (itemRef) => {
            try {
                const meta = await getMetadata(itemRef);
                return meta.size || 0;
            } catch (e) {
                return 0;
            }
        });
        const sizes = await Promise.all(sizePromises);
        totalBytes += sizes.reduce((a, b) => a + b, 0);

        // Recursively scan prefixes
        const folderPromises = res.prefixes.map(prefixRef => traverse(prefixRef));
        await Promise.all(folderPromises);
    }

    await traverse(rootRef);
    return totalBytes;
}

async function calculateDynamicHostingSize() {
    const files = [
        '/index.html',
        '/admin.html',
        '/style.css',
        '/script.js',
        '/admin.js',
        '/about-dean.html',
        '/gallery.html',
        '/safaris.html',
        '/park.html'
    ];
    let totalBytes = 0;
    const promises = files.map(async (url) => {
        try {
            const res = await fetch(url, { method: 'HEAD' });
            const len = res.headers.get('content-length');
            return len ? parseInt(len) : 0;
        } catch (e) {
            return 0;
        }
    });
    const sizes = await Promise.all(promises);
    totalBytes = sizes.reduce((a, b) => a + b, 0);
    return totalBytes || 6030029; // Fallback to baseline size if offline
}

async function updateLiveQuotaMetrics(forceStorageRefresh = false) {
    // 1. Update Firestore Reads & Writes UI (Active Session)
    updateFirestoreQuotaUI();

    // 2. Cloud Storage Space
    const qStorageVal = document.getElementById('q-storage-val');
    const qStorageBar = document.getElementById('q-storage-bar');
    const qStorageDesc = document.getElementById('q-storage-desc');

    if (qStorageVal && qStorageBar && qStorageDesc) {
        if (forceStorageRefresh && !isStorageScanning) {
            isStorageScanning = true;
            qStorageVal.textContent = "Scanning...";

            try {
                const realBytes = await calculateRealStorageSpace();
                cachedStorageBytes = realBytes;
            } catch (err) {
                console.error("Storage recalculation failed:", err);
            } finally {
                isStorageScanning = false;
            }
        }

        const mb = cachedStorageBytes / (1024 * 1024);
        const gb = cachedStorageBytes / (1024 * 1024 * 1024);

        let sizeText = "";
        if (gb >= 0.1) {
            sizeText = `${gb.toFixed(2)} GB`;
        } else {
            sizeText = `${mb.toFixed(2)} MB`;
        }
        qStorageVal.textContent = sizeText;

        const limitBytes = 5 * 1024 * 1024 * 1024; // 5 GB
        const percent = Math.min((cachedStorageBytes / limitBytes) * 100, 100);
        qStorageBar.style.width = `${percent.toFixed(1)}%`;
        qStorageDesc.innerHTML = `<span>Capacity: ${percent.toFixed(2)}%</span><span>Limit: 5.0 GB</span>`;

        // Update health status badge
        const badge = document.getElementById('q-storage-status-badge');
        if (badge) {
            if (percent >= 95) {
                badge.className = "quota-badge critical";
                badge.textContent = "CRITICAL";
            } else if (percent >= 80) {
                badge.className = "quota-badge warning";
                badge.textContent = "WARNING";
            } else {
                badge.className = "quota-badge healthy";
                badge.textContent = "HEALTHY";
            }
        }
    }

    // 3. Firebase Hosting Space
    const qHostSpaceVal = document.getElementById('q-host-space-val');
    const qHostSpaceBar = document.getElementById('q-host-space-bar');
    const qHostSpaceDesc = document.getElementById('q-host-space-desc');

    if (qHostSpaceVal && qHostSpaceBar && qHostSpaceDesc) {
        try {
            const hostingBytes = await calculateDynamicHostingSize();
            const mb = hostingBytes / (1024 * 1024);
            qHostSpaceVal.textContent = `${mb.toFixed(2)} MB`;

            const limitBytes = 10 * 1024 * 1024 * 1024; // 10 GB
            const percent = Math.min((hostingBytes / limitBytes) * 100, 100);
            qHostSpaceBar.style.width = `${percent.toFixed(2)}%`;
            qHostSpaceDesc.innerHTML = `<span>Capacity: ${percent.toFixed(4)}%</span><span>Limit: 10 GB</span>`;
        } catch (e) {
            console.error("Hosting space update failed:", e);
        }
    }

    // 4. Hosting Outbound Transfer (Traffic-Derived Estimator)
    const qHostTransVal = document.getElementById('q-host-trans-val');
    const qHostTransBar = document.getElementById('q-host-trans-bar');
    const qHostTransDesc = document.getElementById('q-host-trans-desc');

    if (qHostTransVal && qHostTransBar && qHostTransDesc) {
        const sliderVisitors = document.getElementById('slider-visitors');
        const dailyVisitors = sliderVisitors ? parseInt(sliderVisitors.value) : 120;

        const estDailyBytes = dailyVisitors * 1.5 * 180 * 1024; // ~1.5 pages per visitor, 180KB each
        const mb = estDailyBytes / (1024 * 1024);

        qHostTransVal.textContent = `${mb.toFixed(1)} MB`;

        const limitMB = 360; // 360 MB per day
        const percent = Math.min((mb / limitMB) * 100, 100);
        qHostTransBar.style.width = `${percent.toFixed(1)}%`;
        qHostTransDesc.innerHTML = `<span>Used Today: ${percent.toFixed(1)}%</span><span>Limit: 360 MB / day</span>`;
    }
}

window.initAnalyticsDashboard = function () {
    // 1. Hook up Sub-Tab Swapping
    const subTabButtons = document.querySelectorAll('.analytics-tab-btn');
    const subViewSections = document.querySelectorAll('.sub-view-section');

    subTabButtons.forEach(btn => {
        btn.onclick = () => {
            subTabButtons.forEach(b => b.classList.remove('active'));
            subViewSections.forEach(s => s.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.dataset.subtarget;
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }

            // If switching to charts, render them to avoid size calculation issues in hidden elements
            if (targetId === 'sub-charts') {
                setTimeout(renderAnalyticsCharts, 100);
            }
            if (targetId === 'sub-usage') {
                updateLiveQuotaMetrics(true); // Scan real-time storage automatically!
            }
        };
    });

    // Hook up Firestore Reads & Writes refresh buttons
    const btnRefreshReads = document.getElementById('btn-refresh-reads');
    const btnRefreshWrites = document.getElementById('btn-refresh-writes');
    const readsRefreshIcon = document.getElementById('reads-refresh-icon');
    const writesRefreshIcon = document.getElementById('writes-refresh-icon');

    if (btnRefreshReads) {
        btnRefreshReads.onclick = async () => {
            if (readsRefreshIcon) readsRefreshIcon.classList.add('fa-spin');
            await window.refreshFirestoreUsageMetrics();
            if (readsRefreshIcon) readsRefreshIcon.classList.remove('fa-spin');
        };
    }
    if (btnRefreshWrites) {
        btnRefreshWrites.onclick = async () => {
            if (writesRefreshIcon) writesRefreshIcon.classList.add('fa-spin');
            await window.refreshFirestoreUsageMetrics();
            if (writesRefreshIcon) writesRefreshIcon.classList.remove('fa-spin');
        };
    }

    // 2. Hook up Live/Mock View Toggling
    const btnToggleLive = document.getElementById('btn-toggle-live');
    const btnToggleMock = document.getElementById('btn-toggle-mock');
    const liveStatsView = document.getElementById('live-stats-view');
    const mockStatsView = document.getElementById('mock-stats-view');

    if (btnToggleLive && btnToggleMock && liveStatsView && mockStatsView) {
        btnToggleLive.onclick = () => {
            btnToggleLive.classList.add('active');
            btnToggleLive.style.background = 'var(--accent-gold)';
            btnToggleLive.style.color = '#000';
            btnToggleLive.style.opacity = '1';

            btnToggleMock.classList.remove('active');
            btnToggleMock.style.background = 'transparent';
            btnToggleMock.style.color = '#fff';
            btnToggleMock.style.opacity = '0.6';

            liveStatsView.style.display = 'block';
            mockStatsView.style.display = 'none';
        };

        btnToggleMock.onclick = () => {
            btnToggleMock.classList.add('active');
            btnToggleMock.style.background = 'var(--accent-gold)';
            btnToggleMock.style.color = '#000';
            btnToggleMock.style.opacity = '1';

            btnToggleLive.classList.remove('active');
            btnToggleLive.style.background = 'transparent';
            btnToggleLive.style.color = '#fff';
            btnToggleLive.style.opacity = '0.6';

            liveStatsView.style.display = 'none';
            mockStatsView.style.display = 'block';

            // Re-render charts so Chart.js can calculate dimensions in visible container
            setTimeout(renderAnalyticsCharts, 50);
        };
    }

    // 2. Initialize Estimator Widget
    const sliderVisitors = document.getElementById('slider-visitors');
    const sliderViews = document.getElementById('slider-views');

    if (sliderVisitors && sliderViews) {
        sliderVisitors.oninput = () => {
            updateQuotaEstimator();
            updateLiveQuotaMetrics(false); // Also update Outbound stats based on estimated visitor slider!
        };
        sliderViews.oninput = updateQuotaEstimator;
        updateQuotaEstimator(); // Run initial calc
    }

    // Initialize Quota Card values
    updateLiveQuotaMetrics(false);

    // 3. Render initial charts if the active tab is charts (defaults to usage)
    const activeSubTab = document.querySelector('.analytics-tab-btn.active');
    if (activeSubTab && activeSubTab.dataset.subtarget === 'sub-charts') {
        renderAnalyticsCharts();
    }
};

function updateQuotaEstimator() {
    const sliderVisitors = document.getElementById('slider-visitors');
    const sliderViews = document.getElementById('slider-views');

    if (!sliderVisitors || !sliderViews) return;

    const visitors = parseInt(sliderVisitors.value);
    const views = parseInt(sliderViews.value);

    // Update slider UI labels
    document.getElementById('slider-visitors-val').textContent = visitors.toLocaleString();
    document.getElementById('slider-views-val').textContent = views;

    // Calculators
    const monthlyPageviews = visitors * views * 30;
    const dailyReads = Math.round(visitors * views * 1.6); // Avg 1.6 firestore reads per page/image load
    const dailyBandwidthMB = Math.round(visitors * views * 0.18); // Avg 180KB transfer per action

    // Render results
    document.getElementById('res-pageviews').textContent = monthlyPageviews.toLocaleString();
    document.getElementById('res-reads').textContent = `${dailyReads.toLocaleString()} / 50,000`;
    document.getElementById('res-bandwidth').textContent = `${dailyBandwidthMB.toLocaleString()} MB / 360 MB`;

    // Rec Badge
    const recBadge = document.getElementById('estimator-rec-badge');
    if (recBadge) {
        if (monthlyPageviews <= 90000 && dailyReads < 45000 && dailyBandwidthMB < 320) {
            recBadge.textContent = "100% FREE SPARK TIER";
            recBadge.style.background = "#2ed573";
        } else if (monthlyPageviews <= 250000 && dailyReads < 50000 && dailyBandwidthMB < 360) {
            recBadge.textContent = "OPTIMAL FOR FREE TIER";
            recBadge.style.background = "#f39c12";
        } else {
            recBadge.textContent = "BLAZE TIER RECOMMENDED";
            recBadge.style.background = "#ff4757";
        }
    }
}

function renderAnalyticsCharts() {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.error("Chart.js is not loaded.");
        return;
    }

    const ctxTraffic = document.getElementById('chart-traffic');
    const ctxDevices = document.getElementById('chart-devices');
    const ctxInteractions = document.getElementById('chart-interactions');

    // Theme Colors
    const goldColor = '#E3A857';

    // 1. Traffic Chart (Line)
    if (ctxTraffic) {
        if (trafficChartInstance) trafficChartInstance.destroy();

        // Simulated traffic values over 30 days
        const days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (29 - i));
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        });
        const pageviewsData = [
            120, 150, 110, 190, 240, 310, 280, 250, 300, 380, 420, 390, 350, 310, 400,
            490, 520, 480, 430, 460, 510, 580, 640, 610, 580, 620, 710, 840, 920, 1420
        ];
        const visitorsData = pageviewsData.map(v => Math.round(v * 0.42)); // ~42% are unique visitors

        trafficChartInstance = new Chart(ctxTraffic, {
            type: 'line',
            data: {
                labels: days,
                datasets: [
                    {
                        label: 'Total Pageviews',
                        data: pageviewsData,
                        borderColor: goldColor,
                        backgroundColor: 'rgba(227, 168, 87, 0.1)',
                        fill: true,
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Unique Visitors',
                        data: visitorsData,
                        borderColor: '#2f3542',
                        backgroundColor: 'transparent',
                        tension: 0.4,
                        borderWidth: 2,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        borderDash: [5, 5]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { font: { family: 'Inter', size: 11 } }
                    },
                    tooltip: {
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { family: 'Inter', weight: 'bold' },
                        bodyFont: { family: 'Inter' }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: { font: { family: 'Inter', size: 10 } }
                    }
                }
            }
        });
    }

    // 2. Devices Chart (Doughnut)
    if (ctxDevices) {
        if (devicesChartInstance) devicesChartInstance.destroy();

        devicesChartInstance = new Chart(ctxDevices, {
            type: 'doughnut',
            data: {
                labels: ['Mobile Phone', 'Desktop PC', 'Tablet Device'],
                datasets: [{
                    data: [68, 27, 5],
                    backgroundColor: [goldColor, '#2F2F2F', '#8B7E66'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 15, font: { family: 'Inter', size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return ` ${context.label}: ${context.raw}%`;
                            }
                        }
                    }
                },
                cutout: '65%'
            }
        });
    }

    // 3. Interactions Chart (Bar)
    if (ctxInteractions) {
        if (interactionsChartInstance) interactionsChartInstance.destroy();

        interactionsChartInstance = new Chart(ctxInteractions, {
            type: 'bar',
            data: {
                labels: [
                    'WhatsApp Inquiries',
                    'Direct Emails Clicked',
                    'Phone Calls Drafted',
                    'Itinerary PDF Downloads',
                    'Park Details Expanded',
                    'Gallery Images Viewed'
                ],
                datasets: [{
                    label: 'Unique Clicks',
                    data: [84, 52, 29, 95, 340, 1120],
                    backgroundColor: [goldColor, goldColor, goldColor, '#8B7E66', '#2F2F2F', '#2F2F2F'],
                    borderRadius: 6,
                    maxBarThickness: 45
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { family: 'Inter', weight: 'bold' },
                        bodyFont: { family: 'Inter' }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { family: 'Inter', size: 10 } }
                    },
                    y: {
                        grid: { color: 'rgba(0,0,0,0.05)' },
                        ticks: { font: { family: 'Inter', size: 10 } }
                    }
                }
            }
        });
    }
}

// Clipboard Marketing Tag Copy
window.copyMarketingCode = function (elementId, btn) {
    const preBlock = document.getElementById(elementId);
    if (!preBlock) return;

    // Decode HTML entities
    const tempTextArea = document.createElement('textarea');
    tempTextArea.innerHTML = preBlock.innerHTML;
    const code = tempTextArea.value;

    navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        btn.style.background = '#2ed573';
        btn.style.color = '#fff';

        if (typeof snackbar === 'object' && typeof showSnackbar === 'undefined') {
            // Check if snackbar is loaded in admin scope
            const sbText = document.getElementById('snackbar-text');
            const sb = document.getElementById('snackbar');
            if (sbText && sb) {
                sbText.textContent = "Tracking script copied to clipboard!";
                sb.classList.add('active');
                setTimeout(() => sb.classList.remove('active'), 3000);
            }
        } else if (typeof showSnackbar === 'function') {
            showSnackbar("Tracking script copied to clipboard!");
        }

        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.style.color = '';
        }, 2000);
    }).catch(err => {
        console.error("Clipboard copy failed:", err);
    });
};

// ============================================================
// === Acknowledgements Panel — Photographers Manager =========
// ============================================================

async function loadPhotographersAdmin() {
    const input = document.getElementById('photographers-input');
    if (!input) return;
    try {
        const snap = await _getDoc(doc(db, 'site_settings', 'acknowledgements'));
        if (snap.exists()) {
            const data = snap.data();
            if (typeof data.photographers === 'string') {
                input.value = data.photographers;
            } else if (Array.isArray(data.photographers)) {
                input.value = data.photographers.join(', ');
            } else {
                input.value = '';
            }
        } else {
            input.value = '';
        }
    } catch (e) {
        console.error('Failed to load photographers:', e);
        input.value = '';
    }
}

async function savePhotographers() {
    const input = document.getElementById('photographers-input');
    if (!input) return;
    const value = input.value.trim();
    try {
        await _setDoc(doc(db, 'site_settings', 'acknowledgements'), {
            photographers: value
        }, { merge: true });
        const sb = document.getElementById('snackbar');
        const sbText = document.getElementById('snackbar-text');
        if (sb && sbText) {
            sbText.textContent = 'Photography credits saved!';
            sb.style.display = 'flex';
            setTimeout(() => { sb.style.display = 'none'; }, 3000);
        }
    } catch (e) {
        console.error('Failed to save photographers:', e);
        alert('Save failed. Check your connection and try again.');
    }
}

// Wire up save/nav once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('btn-save-photographers');
    if (saveBtn) saveBtn.addEventListener('click', savePhotographers);

    // Load photographers when the Acknowledgements nav link is clicked
    const ackNavLink = document.querySelector('[data-target="section-acknowledgements"]');
    if (ackNavLink) {
        ackNavLink.addEventListener('click', () => {
            loadPhotographersAdmin();
        });
    }
});
