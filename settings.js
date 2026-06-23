import { app } from './firebase-init.js';
import { getFirestore, doc, getDoc, setDoc, collection, onSnapshot, increment } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const db = getFirestore(app);

let generalPhotographers = [];

function renderPublicPhotographers() {
    const photographersList = document.querySelectorAll('#photographers-list');
    const photographersSection = document.querySelectorAll('#photographers-acknowledgements');
    
    let listItems = [];
    if (typeof generalPhotographers === 'string') {
        if (generalPhotographers.trim()) {
            listItems = generalPhotographers.split(',').map(name => name.trim()).filter(name => name);
        }
    } else if (Array.isArray(generalPhotographers)) {
        listItems = generalPhotographers.map(name => name.trim()).filter(name => name);
    }

    if (listItems.length === 0) {
        photographersSection.forEach(el => {
            el.style.display = 'none';
        });
        return;
    }

    let listHtml = '';
    listItems.forEach(name => {
        listHtml += `<li>${name}</li>`;
    });

    photographersList.forEach(list => {
        list.innerHTML = listHtml;
    });

    photographersSection.forEach(el => {
        el.style.display = '';
    });
}

async function initSettings() {
    try {
        // --- Dynamic Safaris Menu Handler ---
        const safariMenu = document.getElementById('safaris-dropdown-list');
        if (safariMenu) {
            safariMenu.innerHTML = '<li><a href="safaris.html">Build Your Experience</a></li>';
        }

        // --- Dynamic Gallery Collections Handler ---
        const collectionMenu = document.getElementById('collections-dropdown-list');
        if (collectionMenu) {
            onSnapshot(collection(db, "client_galleries"), (snapshot) => {
                collectionMenu.innerHTML = '';
                if (snapshot.empty) {
                    collectionMenu.innerHTML = '<li><a href="gallery.html">No Collections Yet</a></li>';
                    return;
                }
                
                // Sort alphabetically by title
                const sortedDocs = snapshot.docs.slice().sort((a, b) => {
                    const titleA = (a.data().title || "").toLowerCase();
                    const titleB = (b.data().title || "").toLowerCase();
                    return titleA.localeCompare(titleB);
                });

                sortedDocs.forEach((doc) => {
                    const data = doc.data();
                    if (data.title) {
                        const li = document.createElement('li');
                        li.innerHTML = `<a href="collection.html?id=${doc.id}">${data.title}</a>`;
                        collectionMenu.appendChild(li);
                    }
                });
            }, (error) => {
                console.error("Error listening to galleries:", error);
            });
        }

        // --- Mobile Nested Toggle Handler ---
        document.addEventListener('click', (e) => {
            const hasSub = e.target.closest('.dropdown-item.has-sub');
            if (hasSub && window.innerWidth <= 850) {
                // Click inside sub-dropdown should navigate normally
                if (e.target.closest('.sub-dropdown')) {
                    return;
                }
                // Toggle active state on the parent item
                e.preventDefault();
                e.stopPropagation();
                hasSub.classList.toggle('active');
                return;
            }
            // Click outside any open sub-dropdown should close it
            const openSub = document.querySelector('.dropdown-item.has-sub.active');
            if (openSub && !e.target.closest('.dropdown-item.has-sub')) {
                openSub.classList.remove('active');
            }
        });

        const docRef = doc(db, "site_settings", "globals");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Update Business Address dynamically in footer
            const footerAddressEls = document.querySelectorAll('.footer-address, #footer-address');
            footerAddressEls.forEach(el => {
                el.textContent = data.address || 'Plot 141 Monde Village, Victoria Falls, Zimbabwe.';
            });
            
            // 1. Update simple mailto links (like in footer)
            const simpleEmailLinks = document.querySelectorAll('a[href^="mailto:"]');
            simpleEmailLinks.forEach(link => {
                link.href = `mailto:${data.email}`;
                if (link.children.length === 0) {
                    link.textContent = data.email;
                }
            });

            // 2. Update secure email cards (in Contact Us section)
            const secureEmailLinks = document.querySelectorAll('.secure-email');
            secureEmailLinks.forEach(link => {
                // Clone the node to strip the click event listener from script.js
                const newLink = link.cloneNode(true);
                newLink.href = `mailto:${data.email}`;
                newLink.classList.remove('secure-email');
                newLink.removeAttribute('data-user');
                newLink.removeAttribute('data-domain');
                
                // Update the text safely inside its span
                const span = newLink.querySelector('.obfuscated') || newLink.querySelector('.portal-value span');
                if (span) {
                    span.textContent = data.email;
                    span.classList.remove('obfuscated');
                }
                
                link.parentNode.replaceChild(newLink, link);
            });

            // Update WhatsApp Display Number in Contact Us card
            const waCardSpan = document.querySelector('.whatsapp-number .obfuscated, .whatsapp-number span');
            if (waCardSpan) {
                waCardSpan.textContent = data.whatsapp;
                waCardSpan.classList.remove('obfuscated');
            }

            // 3. Update WhatsApp links (both footer and Contact Us section)
            const rawWaNumber = data.whatsappLink || "263773423079";
            const sanitizedWaNumber = rawWaNumber.replace(/\D/g, ''); // Ensure only digits
            
            const waLinks = document.querySelectorAll('a[href^="https://wa.me/"]');
            waLinks.forEach(link => {
                // Preserve any URL parameters like ?text=...
                let params = "";
                try {
                    const url = new URL(link.href);
                    params = url.search;
                } catch(e) {
                    // Fallback for malformed URLs
                    if (link.href.includes('?')) params = '?' + link.href.split('?')[1];
                }
                
                link.href = `https://wa.me/${sanitizedWaNumber}${params}`;
                
                if (link.children.length === 0) {
                    // It's a simple text link (e.g., footer)
                    link.textContent = data.whatsapp;
                } else {
                    // It's the complex card, so we target the specific span to avoid overwriting the SVG and other HTML
                    const span = link.querySelector('.obfuscated') || link.querySelector('.whatsapp-number span');
                    if (span) {
                        span.textContent = data.whatsapp;
                        span.classList.remove('obfuscated');
                    }
                }
            });

            // 4. Update Socials (Footer)
            const igLinks = document.querySelectorAll('.secure-social[data-platform="instagram"]');
            igLinks.forEach(link => {
                const newLink = link.cloneNode(true);
                newLink.href = `https://instagram.com/${data.instagram}`;
                newLink.target = '_blank';
                newLink.rel = 'noopener noreferrer';
                newLink.classList.remove('secure-social');
                newLink.removeAttribute('data-handle');
                link.parentNode.replaceChild(newLink, link);
            });

            const fbLinks = document.querySelectorAll('.secure-social[data-platform="facebook"]');
            fbLinks.forEach(link => {
                const newLink = link.cloneNode(true);
                newLink.href = `https://www.facebook.com/${data.facebook}`;
                newLink.target = '_blank';
                newLink.rel = 'noopener noreferrer';
                newLink.classList.remove('secure-social');
                newLink.removeAttribute('data-handle');
                link.parentNode.replaceChild(newLink, link);
            });
            
            // 5. Update Podcast Subtitles (Dynamic VTT)
            const vttSnap = await getDoc(doc(db, "site_config", "podcast_vtt"));
            if (vttSnap.exists()) {
                const track = document.getElementById('audio-subtitles');
                if (track) {
                    const blob = new Blob([vttSnap.data().content], { type: 'text/vtt' });
                    track.src = URL.createObjectURL(blob);
                }
            }

            // 6. Update Testimonials (Dynamic Wall of Love)
            const testSnap = await getDoc(doc(db, "site_config", "testimonials"));
            if (testSnap.exists()) {
                const testimonials = testSnap.data().list;
                const grid = document.getElementById('testimonials-grid');
                if (grid && testimonials.length > 0) {
                    grid.innerHTML = '';
                    testimonials.forEach(test => {
                        const card = document.createElement('div');
                        card.className = 'testimonial-card glass-card interactive-hover float-anim';
                        card.setAttribute('data-full-text', test.text);
                        card.setAttribute('data-location', test.location);
                        
                        // Trim text for preview (approx 150 chars)
                        const previewText = test.text.length > 150 ? test.text.substring(0, 150) + "..." : test.text;
                        const formattedPreview = previewText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                        
                        // Get focal point & scale or default
                        const focal = test.focal || { x: 50, y: 50 };
                        const scale = test.scale || 1.0;
                        
                        card.innerHTML = `
                            <div class="user-photo">
                                <img src="${test.photo}" alt="${test.name}" style="object-position: ${focal.x}% ${focal.y}%; transform: scale(${scale});">
                            </div>
                            <p>"${formattedPreview}"</p>
                            <span class="user-name">— ${test.name}</span>
                            <a href="javascript:void(0)" class="read-more">Read Full Story</a>
                        `;
                        grid.appendChild(card);
                    });
                    
                    // Initialize the new Slider logic and re-bind modal listeners defensively
                    const initSliderAndModals = () => {
                        if (window.initializeTestimonialSlider) {
                            window.initializeTestimonialSlider();
                        }
                        if (window.initializeTestimonialModals) {
                            window.initializeTestimonialModals();
                        }
                    };

                    if (window.initializeTestimonialSlider) {
                        // Slider is already registered — call immediately
                        initSliderAndModals();
                    } else {
                        // script.js is still initialising (slow mobile / first paint).
                        // DOMContentLoaded has already fired at this point so registering
                        // another listener would be dead code. Poll via setTimeout instead.
                        // Only requires initializeTestimonialSlider (initializeTestimonialModals
                        // is optional and checked inside initSliderAndModals itself).
                        const tryInit = (attemptsLeft) => {
                            if (window.initializeTestimonialSlider) {
                                initSliderAndModals();
                            } else if (attemptsLeft > 0) {
                                setTimeout(() => tryInit(attemptsLeft - 1), 150);
                            }
                        };
                        setTimeout(() => tryInit(10), 0); // up to 10 × 150ms = 1.5s of retries
                    }
                }
            }

            // 7. Initialize Global Enquiry Hub
            initGlobalEnquiryHub(data);

            // 8. Dynamic Privacy Policy
            const policyContainer = document.querySelector('#privacy-modal .policy-content');
            if (policyContainer && data.privacyPolicy) {
                const p = data.privacyPolicy;
                policyContainer.innerHTML = `
                    <h2>Privacy & Data Protection</h2>
                    <div class="policy-section">
                        <h3>${p.minimizationTitle || 'Data Minimization'}</h3>
                        <p>${p.minimizationContent || ''}</p>
                    </div>
                    <div class="policy-section">
                        <h3>${p.forgottenTitle || 'Right to be Forgotten'}</h3>
                        <p>${p.forgottenContent || ''}</p>
                    </div>
                    <div class="policy-section">
                        <h3>${p.cookieTitle || 'Cookie Policy'}</h3>
                        <p>${p.cookieContent || ''}</p>
                    </div>
                    <div class="policy-section">
                        <h3>${p.governingTitle || 'Governing Law'}</h3>
                        <p>${p.governingContent || ''}</p>
                    </div>
                `;
            }

            // 9. Dynamic Photographers Acknowledgements
            const acknowledgementsRef = doc(db, "site_settings", "acknowledgements");
            try {
                const ackSnap = await getDoc(acknowledgementsRef);
                if (ackSnap.exists()) {
                    generalPhotographers = ackSnap.data().photographers || [];
                    renderPublicPhotographers();
                }
            } catch (e) {
                // No acknowledgements doc yet
            }
        }

        // --- Platform-Wide Daily Usage Tracker (Public Reads) ---
        (async () => {
            try {
                const todayStr = (() => {
                    const d = new Date();
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                })();

                const docRef = doc(db, "site_settings", "usage_tracking");
                const docSnap = await getDoc(docRef);
                
                // Track 2 reads: 1 for fetching site_settings/globals and 1 for checking usage_tracking doc
                const readsToTrack = 2; 

                if (docSnap.exists() && docSnap.data().date === todayStr) {
                    await setDoc(docRef, {
                        reads: increment(readsToTrack)
                    }, { merge: true });
                } else {
                    await setDoc(docRef, {
                        date: todayStr,
                        reads: readsToTrack,
                        writes: 0
                    }, { merge: true });
                }
            } catch (err) {
                // Fail silently to never interrupt visitor experience
                console.warn("Usage tracker sync bypassed:", err);
            }
        })();

    } catch (error) {
        console.error("Error fetching site settings:", error);
    }
}

initSettings();

function initGlobalEnquiryHub(globals) {
    if (document.querySelector('.mobile-enquiry-hub')) return;

    // --- Inject Enquiry System Styles ---
    const style = document.createElement('style');
    style.textContent = `
        .enquiry-notification {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: rgba(44, 44, 44, 0.95);
            color: white;
            padding: 12px 24px;
            border-radius: 50px;
            font-size: 0.9rem;
            font-weight: 500;
            z-index: 10000;
            transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.1);
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
        }
        .enquiry-notification.active {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        @keyframes enquiry-shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
        }
        .shake-animation {
            animation: enquiry-shake 0.4s ease-in-out !important;
        }
        .col-title.mt-2 {
            margin-top: 15px !important;
        }
        .modal-title-tabs {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 20px;
            margin-bottom: 0.5rem;
            font-family: 'Playfair Display', serif;
            font-size: 2.2rem;
            color: #ccc;
        }
        .title-tab {
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0.4;
            padding-bottom: 4px;
            border-bottom: 2px solid transparent;
        }
        .title-tab:hover {
            opacity: 0.8;
        }
        .title-tab.active {
            opacity: 1;
            color: var(--deep-slate);
        }
        .title-tab.whatsapp.active {
            border-bottom-color: #25D366;
        }
        .title-tab.email.active {
            border-bottom-color: var(--deep-slate);
        }
        .title-tab-separator {
            color: #ddd;
            font-weight: 300;
            font-size: 1.8rem;
            pointer-events: none;
            user-select: none;
        }
        .enquiry-modal-card .enquiry-send-btn {
            transition: all 0.3s ease;
        }
        .enquiry-modal-card .enquiry-send-btn.whatsapp-active:hover {
            background: #25D366 !important;
            box-shadow: 0 10px 25px rgba(37, 211, 102, 0.4) !important;
            color: white !important;
        }
        .enquiry-modal-card .enquiry-send-btn.email-active:hover {
            background: var(--deep-slate) !important;
            box-shadow: 0 10px 25px rgba(44, 44, 44, 0.4) !important;
            color: white !important;
        }
        @media (max-width: 768px) {
            .mobile-enquiry-hub .hub-label {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
                transform: none !important;
            }
            .mobile-enquiry-hub .hub-option-wrapper {
                gap: 0 !important;
                pointer-events: auto !important;
                -webkit-tap-highlight-color: transparent;
            }
            .mobile-enquiry-hub .hub-option-wrapper:hover .hub-option-bubble {
                transform: none !important;
            }
            body.modal-open .mobile-enquiry-hub {
                display: none !important;
                opacity: 0 !important;
                visibility: hidden !important;
                pointer-events: none !important;
            }
        }
    `;
    document.head.appendChild(style);

    const notification = document.createElement('div');
    notification.className = 'enquiry-notification';
    notification.id = 'enquiry-notice';
    document.body.appendChild(notification);

    const showNotice = (msg) => {
        notification.textContent = msg;
        notification.classList.add('active');
        setTimeout(() => notification.classList.remove('active'), 4000);
    };

    const shakeEl = (el) => {
        if (!el) return;
        el.classList.add('shake-animation');
        setTimeout(() => el.classList.remove('shake-animation'), 400);
    };

    const rawWaNumber = globals.whatsappLink || "263773423079";
    const waNumber = rawWaNumber.replace(/\D/g, ''); // Sanitize: digits only
    const emailAddress = globals.email || "deanmcgregor" + "safaris" + "@" + "gmail" + ".com";

    const hub = document.createElement('div');
    hub.className = 'mobile-enquiry-hub';
    hub.innerHTML = `
        <div class="hub-fan-options" id="hub-options">
            <div class="hub-option-wrapper email" id="hub-email-btn">
                <span class="hub-label">Email Enquiry</span>
                <div class="hub-option-bubble">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                </div>
            </div>
            <div class="hub-option-wrapper whatsapp" id="hub-wa-btn">
                <span class="hub-label">WhatsApp Enquiry</span>
                <div class="hub-option-bubble">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.29-4.171c1.589.945 3.554 1.443 5.548 1.444 5.46 0 9.894-4.434 9.897-9.896 0-2.646-1.03-5.133-2.901-7.004-1.871-1.871-4.358-2.901-7.004-2.902-5.463 0-9.897 4.436-9.9 9.899 0 2.081.541 4.111 1.566 5.873l-1.006 3.677 3.768-.988l.032-.016z"/></svg>
                </div>
            </div>
        </div>
        <div class="hub-main-bubble" id="hub-main">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        </div>
    `;
    document.body.appendChild(hub);

    const panel = document.createElement('aside');
    panel.className = 'enquiries-sidebar';
    panel.id = 'enquiries-panel';
    panel.innerHTML = `
        <div class="enquiry-card-glass" id="enquiry-card">
            <div class="enquiry-card-header">
                <button class="panel-close-btn" id="close-enquiry-panel">&times;</button>
                <h3>Safari Enquiries</h3>
                <p class="enquiry-intro">Start planning your bespoke wilderness expedition.</p>
            </div>

            <div class="enquiry-tab-content">
                <div class="tab-pane" id="pane-whatsapp">
                    <div class="pane-header-strip whatsapp"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="icon-whatsapp"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.29-4.171c1.589.945 3.554 1.443 5.548 1.444 5.46 0 9.894-4.434 9.897-9.896 0-2.646-1.03-5.133-2.901-7.004-1.871-1.871-4.358-2.901-7.004-2.902-5.463 0-9.897 4.436-9.9 9.899 0 2.081.541 4.111 1.566 5.873l-1.006 3.677 3.768-.988l.032-.016z"/></svg> WhatsApp us</div>
                    <div class="checklist-wrapper">
                        <p class="enquiry-form-title">Let us know what you're enquiring about today:</p>
                        <div class="enquiry-form-grid">
                            <div class="enquiry-col">
                                <span class="col-title">Parks</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Gonarezhou" data-category="park"><span class="checkmark"></span> Gonarezhou</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Hwange" data-category="park"><span class="checkmark"></span> Hwange</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Mana Pools" data-category="park"><span class="checkmark"></span> Mana Pools</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Zambezi" data-category="park"><span class="checkmark"></span> Zambezi</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-Park" data-category="park"><span class="checkmark"></span> Multi-Park</label>
                            </div>
                            <div class="enquiry-col">
                                <span class="col-title">Duration</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Single Day/Night" data-category="type"><span class="checkmark"></span> Single Day (Zambezi only)</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-day" data-category="type"><span class="checkmark"></span> Multi-day</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Expedition (7+ days)" data-category="type"><span class="checkmark"></span> Expedition (7+ days)</label>
                                
                                <span class="col-title mt-2">Special Interests</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Birding" data-category="interest"><span class="checkmark"></span> Birding</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Tiger Fishing" data-category="interest"><span class="checkmark"></span> Tiger Fishing</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Photography" data-category="interest"><span class="checkmark"></span> Photography</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Other Special Interest" data-category="interest"><span class="checkmark"></span> Other</label>

                                <span class="col-title mt-2">Other</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="General Enquiries" data-category="other"><span class="checkmark"></span> General Enquiries</label>
                            </div>
                        </div>
                        <p class="enquiry-footer-note">We would love to hear from you, please send us your message and we will respond as soon as we can</p>
                        <button class="enquiry-send-btn wa-submit">SEND US A MESSAGE &rarr;</button>
                    </div>
                </div>

                <div class="tab-pane" id="pane-email">
                    <div class="pane-header-strip email"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-email"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email us</div>
                    <div class="checklist-wrapper">
                        <p class="enquiry-form-title">Let us know what you're enquiring about today:</p>
                        <div class="enquiry-form-grid">
                            <div class="enquiry-col">
                                <span class="col-title">Parks</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Gonarezhou" data-category="park"><span class="checkmark"></span> Gonarezhou</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Hwange" data-category="park"><span class="checkmark"></span> Hwange</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Mana Pools" data-category="park"><span class="checkmark"></span> Mana Pools</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Zambezi" data-category="park"><span class="checkmark"></span> Zambezi</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-Park" data-category="park"><span class="checkmark"></span> Multi-Park</label>
                            </div>
                            <div class="enquiry-col">
                                <span class="col-title">Duration</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Single Day/Night" data-category="type"><span class="checkmark"></span> Single Day (Zambezi only)</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-day" data-category="type"><span class="checkmark"></span> Multi-day</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Expedition (7+ days)" data-category="type"><span class="checkmark"></span> Expedition (7+ days)</label>
                                
                                <span class="col-title mt-2">Special Interests</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Birding" data-category="interest"><span class="checkmark"></span> Birding</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Tiger Fishing" data-category="interest"><span class="checkmark"></span> Tiger Fishing</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Photography" data-category="interest"><span class="checkmark"></span> Photography</label>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="Other Special Interest" data-category="interest"><span class="checkmark"></span> Other</label>

                                <span class="col-title mt-2">Other</span>
                                <label class="check-container"><input type="checkbox" class="enquiry-check" value="General Enquiries" data-category="other"><span class="checkmark"></span> General Enquiries</label>
                            </div>
                        </div>
                        <p class="enquiry-footer-note">We would love to hear from you, please send us your message and we will respond as soon as we can</p>
                        <button class="enquiry-send-btn email-submit">SEND US AN EMAIL &rarr;</button>
                    </div>
                </div>
            </div>

            <div class="enquiry-bottom-strip">
                <button class="enquiry-trigger whatsapp" data-channel="whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                <button class="enquiry-trigger email" data-channel="email"><i class="far fa-envelope"></i> Email Us</button>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    const hubMain = document.getElementById('hub-main');
    const hubOptions = document.getElementById('hub-options');
    const hubWaBtn = document.getElementById('hub-wa-btn');
    const hubEmailBtn = document.getElementById('hub-email-btn');
    const sidebar = document.getElementById('enquiries-panel');
    const triggers = panel.querySelectorAll('.enquiry-trigger');
    const panes = panel.querySelectorAll('.tab-pane');

    // --- Page Routing Logic ---
    const path = window.location.pathname.toLowerCase();
    
    // Check if the current page is one of our public guest-facing pages.
    // We match specific filename suffixes or path segments to prevent matching folder names like "DeansSafariSite"
    const allowedPages = [
        '/',
        '/index',
        '/safaris',
        '/about-dean',
        '/gallery',
        '/collection',
        '/gonarezhou',
        '/hwange',
        '/mana-pools',
        '/zambezi',
        '/park'
    ];
    
    // Match if it's the root path, or matches one of the clean paths or HTML file extensions
    const isMainPage = allowedPages.some(page => {
        if (page === '/') {
            return path === '/' || path.endsWith('/');
        }
        return path.endsWith(page) || path.includes(page + '.') || path.includes(page + '/');
    });
    
    // Hide bubbles on non-main pages
    if (!isMainPage) {
        hub.style.display = 'none';
        sidebar.style.display = 'none';
    }

    // --- Modal Implementation (for other pages) ---
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'enquiry-modal-overlay';
    modalOverlay.id = 'enquiry-modal';
    modalOverlay.innerHTML = `
        <div class="enquiry-modal-card">
            <button class="panel-close-btn">&times;</button>
            <h2 class="modal-title-tabs" id="modal-title-container">
                <span class="title-tab whatsapp" data-channel="whatsapp">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" class="icon-whatsapp"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.246 2.248 3.484 5.232 3.484 8.412-.003 6.557-5.338 11.892-11.893 11.892-1.997-.001-3.951-.5-5.688-1.448l-6.309 1.656zm6.29-4.171c1.589.945 3.554 1.443 5.548 1.444 5.46 0 9.894-4.434 9.897-9.896 0-2.646-1.03-5.133-2.901-7.004-1.871-1.871-4.358-2.901-7.004-2.902-5.463 0-9.897 4.436-9.9 9.899 0 2.081.541 4.111 1.566 5.873l-1.006 3.677 3.768-.988l.032-.016z"/></svg>
                    Whatsapp Us
                </span>
                <span class="title-tab-separator">|</span>
                <span class="title-tab email" data-channel="email">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-email"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                    Email Us
                </span>
            </h2>
            <p class="modal-subtitle">Start planning your bespoke wilderness expedition</p>
            <p class="modal-prompt">Let us know what you're enquiring about today:</p>
            
            <div class="enquiry-form-grid">
                <div class="enquiry-col">
                    <span class="col-title">Parks</span>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Gonarezhou" data-category="park"><span class="checkmark"></span> Gonarezhou</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Hwange" data-category="park"><span class="checkmark"></span> Hwange</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Mana Pools" data-category="park"><span class="checkmark"></span> Mana Pools</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Zambezi" data-category="park"><span class="checkmark"></span> Zambezi</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-Park" data-category="park"><span class="checkmark"></span> Multi-Park</label>
                </div>
                <div class="enquiry-col">
                    <span class="col-title">Duration</span>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Single Day/Night" data-category="type"><span class="checkmark"></span> Single Day (Zambezi only)</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Multi-day" data-category="type"><span class="checkmark"></span> Multi-day</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Expedition (7+ days)" data-category="type"><span class="checkmark"></span> Expedition (7+ days)</label>
                </div>
                <div class="enquiry-col">
                    <span class="col-title">Special Interests</span>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Birding" data-category="interest"><span class="checkmark"></span> Birding</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Tiger Fishing" data-category="interest"><span class="checkmark"></span> Tiger Fishing</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Photography" data-category="interest"><span class="checkmark"></span> Photography</label>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="Other Special Interest" data-category="interest"><span class="checkmark"></span> Other</label>
                </div>
                <div class="enquiry-col">
                    <span class="col-title">Other</span>
                    <label class="check-container"><input type="checkbox" class="enquiry-check" value="General Enquiries" data-category="other"><span class="checkmark"></span> General Enquiries</label>
                </div>
            </div>
            
            <p class="enquiry-footer-note">We look forward to hearing from you. Please send us your enquiry and we will get back to you as soon as we can.</p>
            <button class="enquiry-send-btn modal-submit">SEND ENQUIRY &rarr;</button>
        </div>
    `;
    document.body.appendChild(modalOverlay);

    const tabs = modalOverlay.querySelectorAll('.title-tab');
    const modalSubmit = modalOverlay.querySelector('.modal-submit');
    let modalChannel = 'whatsapp';

    const updateModalChannel = (channel) => {
        modalChannel = channel;
        tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.channel === channel);
        });
        
        if (channel === 'whatsapp') {
            modalSubmit.textContent = 'SEND WHATSAPP ENQUIRY →';
            modalSubmit.className = 'enquiry-send-btn modal-submit whatsapp-active';
        } else {
            modalSubmit.textContent = 'SEND EMAIL ENQUIRY →';
            modalSubmit.className = 'enquiry-send-btn modal-submit email-active';
        }
    };

    tabs.forEach(tab => {
        tab.onclick = () => {
            updateModalChannel(tab.dataset.channel);
        };
    });

    const openModal = (channel) => {
        updateModalChannel(channel);
        modalOverlay.classList.add('active');
        document.body.classList.add('modal-open');
        
        // Auto-select the checkbox corresponding to the current park page we are on
        const currentPath = window.location.pathname.toLowerCase();
        let targetPark = null;
        if (currentPath.includes('gonarezhou')) targetPark = 'Gonarezhou';
        else if (currentPath.includes('hwange')) targetPark = 'Hwange';
        else if (currentPath.includes('mana-pools')) targetPark = 'Mana Pools';
        else if (currentPath.includes('zambezi')) targetPark = 'Zambezi';
        
        if (targetPark) {
            const checkboxes = modalOverlay.querySelectorAll(`.enquiry-check[value="${targetPark}"]`);
            checkboxes.forEach(cb => cb.checked = true);
        }
    };

    const closeModal = () => {
        modalOverlay.classList.remove('active');
        document.body.classList.remove('modal-open');
    };

    modalOverlay.querySelector('.panel-close-btn').onclick = closeModal;
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };

    let currentActiveChannel = null;

    const switchTab = (channel) => {
        triggers.forEach(t => t.classList.toggle('active', t.dataset.channel === channel));
        panes.forEach(p => p.classList.toggle('active', p.id === `pane-${channel}`));
    };

    const openPanel = (channel, parkTitle = null) => {
        const isVisible = sidebar.classList.contains('active');
        if (isVisible && currentActiveChannel === channel && !parkTitle) {
            sidebar.classList.remove('active');
            currentActiveChannel = null;
        } else {
            sidebar.classList.add('active');
            switchTab(channel);
            currentActiveChannel = channel;
            if (parkTitle) {
                const checkboxes = sidebar.querySelectorAll(`.enquiry-check[value="${parkTitle}"]`);
                checkboxes.forEach(cb => cb.checked = true);
            }
        }
    };

    window.openEnquirySystem = (channel, parkTitle = null, forceSidebar = false) => {
        // Reset all checkboxes to false first to start clean
        document.querySelectorAll('.enquiry-check').forEach(cb => cb.checked = false);

        if (forceSidebar) {
            openPanel(channel, parkTitle);
        } else {
            openModal(channel);
            if (parkTitle) {
                const checkboxes = modalOverlay.querySelectorAll(`.enquiry-check[value="${parkTitle}"]`);
                checkboxes.forEach(cb => cb.checked = true);
            }
        }
    };

    window.openEnquiryPanel = (parkTitle) => {
        // From park buttons, we stick to modal as it feels like a focused enquiry
        window.openEnquirySystem(currentActiveChannel || 'whatsapp', parkTitle, false);
    };

    // --- Link Interception ---
    const interceptLinks = () => {
        const links = document.querySelectorAll('a[href^="mailto:"], a[href*="wa.me"], .portal-card, .footer-contact-item a, .enquiry-trigger-modal');
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                // If the link has an explicit data-channel, use it
                const forcedChannel = link.getAttribute('data-channel');
                
                // If the link already has a predefined message or subject AND no forced channel, let it work normally
                const url = link.href || "";
                if (!forcedChannel && (url.includes('?text=') || url.includes('?subject=') || url.includes('?body='))) {
                    return; 
                }

                e.preventDefault();
                e.stopPropagation();
                
                let isWa = false;
                if (forcedChannel) {
                    isWa = forcedChannel === 'whatsapp';
                } else {
                    isWa = url.includes('wa.me') || link.classList.contains('secure-wa') || link.textContent.includes('+263') || link.closest('.whatsapp') || link.closest('.whatsapp-number');
                }
                
                window.openEnquirySystem(isWa ? 'whatsapp' : 'email', null, false);
            });
        });
    };
    interceptLinks();

    hubMain.onclick = () => {
        const isActive = hubMain.classList.toggle('active');
        hubOptions.classList.toggle('active');
        if (!isActive) sidebar.classList.remove('active');
    };

    const closeBtn = document.getElementById('close-enquiry-panel');
    if (closeBtn) {
        closeBtn.onclick = () => sidebar.classList.remove('active');
    }

    hubWaBtn.onclick = (e) => { 
        e.stopPropagation(); 
        openModal('whatsapp');
    };
    hubEmailBtn.onclick = (e) => { 
        e.stopPropagation(); 
        openModal('email');
    };

    triggers.forEach(trigger => {
        trigger.onclick = () => switchTab(trigger.dataset.channel);
    });

    const getEnquiryBody = (container) => {
        if (!container) return null;
        const parks = Array.from(container.querySelectorAll('.enquiry-check[data-category="park"]:checked')).map(el => el.value);
        const types = Array.from(container.querySelectorAll('.enquiry-check[data-category="type"]:checked')).map(el => el.value);
        const interests = Array.from(container.querySelectorAll('.enquiry-check[data-category="interest"]:checked')).map(el => el.value);
        const other = Array.from(container.querySelectorAll('.enquiry-check[data-category="other"]:checked')).map(el => el.value);
        
        if (parks.length === 0 && types.length === 0 && interests.length === 0 && other.length === 0) return null;
        
        return `Hi Justine, I'd like to enquire about:\n${parks.length > 0 ? '\nParks: ' + parks.join(', ') : ''}${types.length > 0 ? '\nDuration: ' + types.join(', ') : ''}${interests.length > 0 ? '\nSpecial Interests: ' + interests.join(', ') : ''}${other.length > 0 ? '\nOther: ' + other.join(', ') : ''}\n\nLooking forward to hearing from you!`;
    };

    const waSubmit = panel.querySelector('.wa-submit');
    if (waSubmit) {
        waSubmit.onclick = (e) => {
            const container = e.target.closest('.tab-pane');
            const body = getEnquiryBody(container);
            if (!body) {
                shakeEl(container || panel.querySelector('#enquiry-card'));
                return showNotice("Please select at least one option to send your enquiry.");
            }
            window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(body)}`, '_blank');
        };
    }

    const emailSubmit = panel.querySelector('.email-submit');
    if (emailSubmit) {
        emailSubmit.onclick = (e) => {
            const container = e.target.closest('.tab-pane');
            const body = getEnquiryBody(container);
            if (!body) {
                shakeEl(container || panel.querySelector('#enquiry-card'));
                return showNotice("Please select at least one option to send your enquiry.");
            }
            window.location.href = `mailto:${emailAddress}?subject=Safari Enquiry&body=${encodeURIComponent(body)}`;
        };
    }

    if (modalSubmit) {
        modalSubmit.onclick = () => {
            const body = getEnquiryBody(modalOverlay);
            if (!body) {
                shakeEl(modalOverlay.querySelector('.enquiry-modal-card'));
                return showNotice("Please select at least one option to send your enquiry.");
            }
            if (modalChannel === 'whatsapp') {
                window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(body)}`, '_blank');
            } else {
                window.location.href = `mailto:${emailAddress}?subject=Safari Enquiry&body=${encodeURIComponent(body)}`;
            }
        };
    }
}
