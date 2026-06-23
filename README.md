# Safari Operations — Administration Portal & Web App

[![Stack](https://img.shields.io/badge/Stack-HTML5%20%7C%20CSS3%20%7C%20JS%20(ES6%2B)-orange?style=flat-square)](#)
[![Database](https://img.shields.io/badge/Database-Cloud%20Firestore-blue?logo=firebase&style=flat-square)](#)
[![Serverless](https://img.shields.io/badge/Serverless-Firebase%20Cloud%20Functions-yellow?logo=firebase&style=flat-square)](#)
[![Hosting](https://img.shields.io/badge/Hosting-Firebase%20Hosting-bf360c?logo=firebase&style=flat-square)](#)
[![Licence](https://img.shields.io/badge/Licence-Proprietary-red?style=flat-square)](#licence)

A premium, serverless web application and administration suite designed for a luxury Zimbabwe-based safari operation, developed and owned by **AilseeCodes**. The system manages safari tour information, operational schedules, gallery assets, and client testimonials dynamically from a secure dashboard.

---

## 🌟 Key Features

### 1. Unified Administration Suite (`admin.html`)
* **Safari Management**: Real-time CRUD operations for safari itineraries, activities, locations, and cover images.
* **Acknowledgements System**: A single, central field to manage website photography and typography credits dynamically across the application.
* **Park & Wildlife Logs**: Live logs tracking current park status, safari operations, and guides.
* **Secure Access**: Protected by Firebase Authentication (restricted access).

### 2. High-Performance Client Web App
* **Interactive Itineraries (`safaris.html`)**: Beautifully responsive pages loading details dynamically from Cloud Firestore.
* **Wildlife Gallery (`gallery.html`)**: Rich visual gallery optimised for rapid page loading and smooth media preview transitions.
* **Safari Details (`collection.html`)**: Focus pages displaying details, testimonials, maps, and specific safari features.
* **Custom User Experience**: Customised interactive elements, including micro-animations, a custom animal cursor, audio snippet players, and dynamic sliders.

### 3. Serverless Cloud Operations
* **Automated Image Optimisation Cloud Function (`realTimeOptimizer`)**: A Firebase Cloud Function trigger that executes on Google Cloud Storage uploads. It automatically strips EXIF metadata, strips embedded profiles, compresses images (JPEG/WebP), and saves substantial bandwidth.
* **Dynamic Search & Social Pre-views**: Custom OpenGraph metadata with WhatsApp preview pre-warming logic.
* **Favicon Clamping**: Optimised high-resolution favicons with color smearing algorithms to render beautifully in both Google Search results and modern web browsers.

---

## 🛠️ Architecture & Tech Stack

```mermaid
graph TD
    Client[Web Browser Client] -->|Auth Requests| Auth[Firebase Authentication]
    Client -->|Dynamic Queries| Firestore[Cloud Firestore]
    Client -->|Fetches Static Assets| Hosting[Firebase Hosting]
    Admin[Admin Panel] -->|Uploads Raw Images| Storage[Cloud Storage]
    Storage -->|Trigger OnUpload| CloudFunc[realTimeOptimizer Cloud Function]
    CloudFunc -->|Saves Compressed Image| Storage
```

* **Frontend**: Semantic HTML5, Modular CSS3 (Vanilla design tokens, transitions, custom properties), Vanilla JavaScript (ES6+ async/await, Real-time Firestore Listeners).
* **Database**: Cloud Firestore (Structured collections: `site_settings`, `safaris`, `gallery`).
* **Storage**: Firebase Cloud Storage (Optimised for rich imagery).
* **Serverless Backend**: Node.js Firebase Cloud Functions (incorporating automated optimisation tools).
* **Security Rules**: Robust Firebase Security Rules protecting Firestore collections and Storage paths.

---

## 🎨 Portfolio Showcase

This repository serves as a portfolio showcase of a client project. It is intended for code review, recruitment, and demonstration purposes.

Please note that this application relies on private database instances, cloud functions, and specific configurations that are not included here, so it is not designed to be deployed or run locally as a standalone app.

---

## 📄 Licence

This codebase is provided for portfolio evaluation and code review. As it contains proprietary client assets and configurations, we kindly ask that you do not deploy, re-host, or use it for commercial purposes. See the [LICENSE](LICENSE) file for more details.
