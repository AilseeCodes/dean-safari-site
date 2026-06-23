import { app } from './firebase-init.js';
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const db = getFirestore(app);

let parksData = [];
let extrasData = [];

async function initSafaris() {
    try {
        await loadDynamicSafarisContent();
    } catch (e) {
        console.error("Safaris.js: Content load error:", e);
    }
}

initSafaris();

async function loadDynamicSafarisContent() {
    const introSnap = await getDoc(doc(db, "site_config", "safaris_page"));
    if (introSnap.exists()) {
        const introBox = document.querySelector('.sketch-brackets-box p');
        if (introBox) {
            const rawText = introSnap.data().intro || '';
            let formatted = rawText
                .replace(/\n\n/g, '</p><p>')
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            
            // Create interactive links for parks
            const parkMap = {
                'hwange': 'hwange',
                'zambezi': 'zambezi',
                'mana pools': 'mana-pools',
                'manapools': 'mana-pools',
                'gonarezhou': 'gonarezhou'
            };

            Object.keys(parkMap).forEach(key => {
                const regex = new RegExp(`<strong>(${key}.*?)</strong>`, 'gi');
                formatted = formatted.replace(regex, `<strong class="park-jump-trigger" data-target="${parkMap[key]}">$1</strong>`);
            });

            introBox.innerHTML = formatted;

            // Add click listeners
            introBox.querySelectorAll('.park-jump-trigger').forEach(el => {
                el.addEventListener('click', () => {
                    const targetId = el.getAttribute('data-target');
                    const targetEl = document.getElementById(targetId);
                    if (targetEl) {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                });
            });
        }
    }

    const parksSnap = await getDocs(collection(db, "park_operations"));
    parksData = parksSnap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(p => !['hwange-national-park', 'new-operations'].includes(p.id));
    
    // Sort by order field
    const defaultOrder = { 'zambezi': 0, 'hwange': 1, 'mana-pools': 2, 'gonarezhou': 3 };
    parksData.sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : (defaultOrder[a.id] !== undefined ? defaultOrder[a.id] : 999);
        const orderB = b.order !== undefined ? b.order : (defaultOrder[b.id] !== undefined ? defaultOrder[b.id] : 999);
        return orderA - orderB;
    });

    extrasData = [];

    if (parksData.length > 0) {
        renderSchematic();
        renderAllZigZagSections();
    }

    const travelSnap = await getDoc(doc(db, "site_config", "safaris_travel"));
    if (travelSnap.exists()) {
        renderTravelInfo(travelSnap.data());
    }
}

function renderSchematic() {
    const parkListContainer = document.querySelector('.sketch-park-list');
    if (!parkListContainer) return;

    // Filter parks to exclude those with show_seasonal_schematic explicitly false
    const sortedParks = parksData.filter(p => p.show_seasonal_schematic !== false);

    const schematicSection = document.querySelector('.safaris-schematic-section');
    if (sortedParks.length === 0) {
        if (schematicSection) schematicSection.style.display = 'none';
        return;
    } else {
        if (schematicSection) schematicSection.style.display = 'block';
    }

    parkListContainer.innerHTML = '';

    sortedParks.forEach((park) => {
        const btn = document.createElement('button');
        btn.className = 'park-link'; // No active class by default
        btn.dataset.park = park.id;
        btn.textContent = park.title;
        btn.onclick = () => {
            const isActive = btn.classList.contains('active');
            const revealContainer = document.querySelector('.schematic-reveal-container');

            // Reset all
            document.querySelectorAll('.park-link').forEach(l => l.classList.remove('active'));
            
            if (isActive) {
                // Collapse if it was already active
                if (revealContainer) revealContainer.classList.remove('visible');
            } else {
                // Show/Update if it was not active
                btn.classList.add('active');
                if (revealContainer) revealContainer.classList.add('visible');
                updateMonthGrid(park.id);
            }
        };
        parkListContainer.appendChild(btn);
    });

    // Initialize month grid empty structure if needed
    const grid = document.querySelector('.sketch-month-grid');
    if (grid && grid.children.length === 0) {
        grid.innerHTML = Array(12).fill('<div class="month-cell"><span></span></div>').join('');
        const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        grid.querySelectorAll('.month-cell span').forEach((span, i) => {
            span.textContent = months[i];
        });
    }
}

function updateMonthGrid(parkId) {
    const park = parksData.find(p => p.id === parkId);
    if (!park || !park.months) return;
    const monthCells = document.querySelectorAll('.month-cell');
    monthCells.forEach((cell, index) => {
        cell.className = 'month-cell';
        const status = park.months[index] || 'closed';
        cell.classList.add(status);
    });
}

function renderAllZigZagSections() {
    const container = document.querySelector('.safaris-zigzag-container');
    if (!container) return;
    container.innerHTML = '';

    const orderedCore = parksData;
    const allItems = orderedCore;

    allItems.forEach((item, index) => {
        const isReverse = index % 2 !== 0;
        const row = document.createElement('div');
        row.className = `zigzag-row ${isReverse ? 'reverse' : ''}`;
        if (item.id) row.id = item.id;

        const contentSide = document.createElement('div');
        contentSide.className = 'zigzag-content-side';
        
        const formattedSubtitle = (item.subtitle || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        let descriptionHtml = '';
        if (item.description) {
            const pText = item.description.replace(/\n\n/g, '</p><p>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            descriptionHtml += `<div class="zigzag-description"><p>${pText}</p></div>`;
        }
        
        if (item.bullets) {
            const bulletLines = item.bullets.split('\n').filter(line => line.trim() !== '');
            if (bulletLines.length > 0) {
                const isLastPanel = index === allItems.length - 1;
                descriptionHtml += `
                    <div class="zigzag-bullets-wrapper" style="${isLastPanel ? 'border-top: none; padding-top: 0;' : ''}">
                        ${isLastPanel ? '' : `<h4>${item.bullet_subtitle || 'Highlights'}</h4>`}
                        <ul class="zigzag-bullets">
                            ${bulletLines.map(b => `<li>${b.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
        }

        if (item.sections && Array.isArray(item.sections)) {
            item.sections.forEach(sec => {
                const cleanText = (sec.text || '').trim();
                if (cleanText) {
                    const pText = cleanText.replace(/\n\n/g, '</p><p>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                    descriptionHtml += `<div class="zigzag-description"><p>${pText}</p></div>`;
                }
                if (sec.bullets && Array.isArray(sec.bullets)) {
                    const bulletLines = sec.bullets.filter(b => b && b.trim() !== '');
                    if (bulletLines.length > 0) {
                        const isLastPanel = index === allItems.length - 1;
                        descriptionHtml += `
                            <div class="zigzag-bullets-wrapper" style="${isLastPanel ? 'border-top: none; padding-top: 0;' : ''}">
                                ${isLastPanel ? '' : `<h4>${sec.heading || 'Highlights'}</h4>`}
                                <ul class="zigzag-bullets">
                                    ${bulletLines.map(b => `<li>${b.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}
                                </ul>
                            </div>
                        `;
                    }
                }
            });
        }

        contentSide.innerHTML = `
            <div class="zigzag-text-box">
                <h2>${item.title}</h2>
                <div class="zigzag-intro">${formattedSubtitle}</div>
                ${descriptionHtml}
                <button class="enquiry-bubble-trigger" onclick="window.openEnquiryPanel('${item.title}')">
                    <i class="fas fa-paper-plane"></i>
                    <span>Enquire Now</span>
                </button>
            </div>
        `;

        const imageSide = document.createElement('div');
        imageSide.className = 'zigzag-image-side';
        
        let imgUrl = item.hero_img_url || '';
        if (imgUrl && imgUrl.startsWith('assets/')) {
            imgUrl = '/' + imgUrl;
        }
        imageSide.style.backgroundImage = `url('${imgUrl}')`;
        
        imageSide.innerHTML = `
            <div class="zigzag-mobile-header">
                <h2>${item.title}</h2>
            </div>
        `;
        
        if (item.photo_credit || item.credit) {
            const creditDiv = document.createElement('div');
            creditDiv.className = 'photo-credit';
            creditDiv.textContent = item.photo_credit || item.credit;
            imageSide.appendChild(creditDiv);
        }

        row.appendChild(contentSide);
        row.appendChild(imageSide);
        container.appendChild(row);
    });
}

function renderTravelInfo(data) {
    const mainElement = document.querySelector('.safaris-main-content');
    if (!mainElement) return;

    const travelSection = document.createElement('section');
    travelSection.className = 'safaris-travel-section';
    const container = document.createElement('div');
    container.className = 'container travel-info-centered';
    
    const h3 = document.createElement('h3');
    h3.textContent = data.title || "Travel & Access Info";
    container.appendChild(h3);

    const travelBox = document.createElement('div');
    travelBox.className = 'zigzag-description';
    let contentHtml = '';
    if (data.content) {
        contentHtml = `<p>${data.content.replace(/\n\n/g, '</p><p>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>`;
    } else if (data.items && Array.isArray(data.items)) {
        contentHtml = `<ul>${data.items.map(item => `<li>${item.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('')}</ul>`;
    }
    travelBox.innerHTML = contentHtml;
    
    container.appendChild(travelBox);
    travelSection.appendChild(container);
    mainElement.appendChild(travelSection);
}

