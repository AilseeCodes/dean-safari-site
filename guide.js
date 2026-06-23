import { app } from './firebase-init.js';
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const db = getFirestore(app);

function initGuide() {
    // Listen for real-time updates to Dean's profile
    const profileRef = doc(db, "guide_profile", "dean");
    
    onSnapshot(profileRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            renderGuideProfile(data);
        } else {
            console.warn("Guide profile document 'dean' not found.");
            const introContainer = document.getElementById('guide-intro');
            if (introContainer) introContainer.innerHTML = "<p>Biography content is being prepared.</p>";
        }
    });
}

initGuide();

function renderGuideProfile(data) {
    // Helper to format text with paragraphs and bolding
    const formatText = (text) => {
        if (!text) return "";
        // Normalize newlines and handle both single (br) and double (p) breaks
        return text.split(/\r?\n\s*\r?\n/).map(p => {
            const formatted = p.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\r?\n/g, '<br>');
            return `<p>${formatted}</p>`;
        }).join('');
    };

    // 1. Render Dynamic Key Facts (Smart Hide)
    const factsList = document.querySelector('.facts-list');
    if (factsList) {
        factsList.innerHTML = '';
        const facts = data.facts || [];
        facts.forEach(fact => {
            // Smart Hide: Skip if label or value is empty
            if (!fact.label || !fact.value) return;

            const formattedLabel = fact.label.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            const formattedValue = fact.value.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            const li = document.createElement('li');
            li.innerHTML = `<strong>${formattedLabel}:</strong> <span>${formattedValue}</span>`;
            factsList.appendChild(li);
        });
    }

    // 2. Render Intro (Always show if exists)
    const introContainer = document.getElementById('guide-intro');
    if (introContainer) {
        let introHtml = '';
        if (data.intro_title) {
            introHtml += `<h3>${data.intro_title}</h3>`;
        }
        introHtml += formatText(data.intro);
        introContainer.innerHTML = introHtml;
    }

    // 3. Render Dynamic Sections (Smart Hide)
    const dynamicContainer = document.getElementById('guide-dynamic-sections');
    if (dynamicContainer) {
        dynamicContainer.innerHTML = '';
        const sections = data.sections || [];
        
        sections.forEach(section => {
            // Smart Hide: If both title and text are empty, skip it
            if (!section.title && !section.text) return;
            
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'bio-section';
            sectionDiv.innerHTML = `
                <h3>${section.title || ''}</h3>
                <div class="section-content">
                    ${formatText(section.text)}
                </div>
            `;
            dynamicContainer.appendChild(sectionDiv);
        });
    }

    // 4. Render Triptych Images (Left and Right)
    const leftImgContainer = document.getElementById('t-img-left');
    const rightImgContainer = document.getElementById('t-img-right');
    
    if (leftImgContainer && rightImgContainer) {
        const images = (data.image_urls && data.image_urls.length >= 2) ? data.image_urls : [
            "https://images.unsplash.com/photo-1516422317184-268a44c3d05b?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1547407139-3c921a66005c?auto=format&fit=crop&q=80&w=800"
        ];

        leftImgContainer.innerHTML = `<img src="${images[0]}" class="guide-profile-img" alt="Dean McGregor" loading="lazy">`;
        rightImgContainer.innerHTML = `<img src="${images[1]}" class="guide-profile-img" alt="Dean McGregor" loading="lazy">`;
    }

    // 5. Render Diptych Image (Third) and Quote
    const thirdImgContainer = document.getElementById('t-img-third');
    const quoteContainer = document.getElementById('guide-footer-quote');

    if (thirdImgContainer) {
        const images = (data.image_urls && data.image_urls.length >= 3) ? data.image_urls : [
            "https://images.unsplash.com/photo-1516422317184-268a44c3d05b?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1547407139-3c921a66005c?auto=format&fit=crop&q=80&w=800",
            "https://images.unsplash.com/photo-1511497584788-8767fe78e726?auto=format&fit=crop&q=80&w=800"
        ];
        thirdImgContainer.innerHTML = `<img src="${images[2]}" class="guide-profile-img" alt="Dean McGregor" loading="lazy">`;
    }

    if (quoteContainer) {
        quoteContainer.innerHTML = formatText(data.footer_quote || "Expert guidance for your next wilderness expedition.");
    }

    // 5. Update Hero Image if specified
    if (data.hero_image_url && document.getElementById('guide-hero')) {
        document.getElementById('guide-hero').style.backgroundImage = `url('${data.hero_image_url}')`;
    }
}
