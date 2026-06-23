import { app } from './firebase-init.js';
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const db = getFirestore(app);

async function initHome() {
    const gateway = document.getElementById('safari-gateway');
    if (!gateway) return;

    try {
        const docSnap = await getDoc(doc(db, "site_config", "safaris_main_panel"));
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            const titleEl = document.getElementById('gateway-title');
            const descEl = document.getElementById('gateway-desc');
            
            if (titleEl) titleEl.innerHTML = (data.title || "Bespoke Safari Expeditions").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            if (descEl) descEl.innerHTML = (data.description || "Discover Zimbabwe's premier wilderness areas.").replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            if (data.imageUrl) {
                gateway.style.backgroundImage = `url('${data.imageUrl}')`;
            }
        } else {
            // Default Fallback
            gateway.style.backgroundImage = "url('assets/images/gallery-elephant-water.jpg')";
            document.getElementById('gateway-desc').textContent = "Join Dean for an immersive multi-day expedition into Zimbabwe's iconic national parks.";
        }
    } catch (error) {
        console.error("Error fetching safari gateway config:", error);
    }
}

initHome();
