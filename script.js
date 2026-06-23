document.addEventListener('DOMContentLoaded', () => {
    // --- Safe Hash Scroll on Initial Page Load ---
    if (window.location.hash) {
        const hashTargetId = window.location.hash.split('#')[1];
        const hashTargetElement = document.getElementById(hashTargetId);
        if (hashTargetElement) {
            // Prevent browser from snapping instantly before heights/styles are computed
            setTimeout(() => {
                const navHeight = document.querySelector('.navbar').offsetHeight;
                const targetPosition = hashTargetElement.getBoundingClientRect().top + window.pageYOffset - navHeight;
                window.scrollTo({ top: targetPosition, behavior: 'auto' });
            }, 300);
            
            // Double scan for dynamic rendering offsets (like testimonials sliders)
            setTimeout(() => {
                const navHeight = document.querySelector('.navbar').offsetHeight;
                const targetPosition = hashTargetElement.getBoundingClientRect().top + window.pageYOffset - navHeight;
                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
            }, 700);
        }
    }

    // --- Secret Easter Egg: Elephant Cursor ---
    if (window.location.href.toLowerCase().includes('ele-cursor')) {
        document.body.classList.add('ele-mode');
        console.log('🐘 Secret Safari Mode Activated!');
    }
    // Set current year in footer
    const yearSpan = document.getElementById('year');
    if (yearSpan) {
        yearSpan.textContent = new Date().getFullYear();
    }

    // Parallax Effect for Hero — desktop only (mobile browsers jank with JS parallax)
    const parallaxImages = document.querySelectorAll('.parallax-img');

    const isMobileWidth = () => window.innerWidth <= 850;

    if (parallaxImages.length && !isMobileWidth()) {
        // Cache the initial offset once — avoids forced layout reflow on every scroll tick
        const parallaxCache = Array.from(parallaxImages).map(img => ({
            el: img,
            initialOffset: img.offsetHeight * 0.05
        }));

        let parallaxTicking = false;
        window.addEventListener('scroll', () => {
            if (isMobileWidth() || parallaxTicking) return;
            parallaxTicking = true;
            requestAnimationFrame(() => {
                const scrollPos = window.scrollY;
                const speed = 0.15;
                parallaxCache.forEach(({ el, initialOffset }) => {
                    el.style.transform = `translateY(${-initialOffset - (scrollPos * speed)}px)`;
                });
                parallaxTicking = false;
            });
        }, { passive: true });
    }

    // Smooth scroll for anchor links - REMOVED (Handled by CSS scroll-padding-top)

    // Legacy Secure Email Handler - Removed in favor of Enquiry Modal in settings.js
    // ... logic now handled by interceptLinks in settings.js

    // Secure Social Handler (Fortress Strategy)
    const socialLinks = document.querySelectorAll('.secure-social');
    socialLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const platform = link.getAttribute('data-platform');
            let handle = link.getAttribute('data-handle');
            if (handle) {
                handle = handle.split('').reverse().join('');
            }

            let url = '';
            if (platform === 'instagram') {
                url = `https://instagram.com/${handle}`;
            } else if (platform === 'facebook') {
                url = `https://www.facebook.com/${handle ? handle : ''}`;
            }

            if (url) {
                window.open(url, '_blank');
            }
        });
    });

    // Mobile Nav Toggle
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navToggle.classList.toggle('active');
            navLinks.classList.toggle('active');
            document.body.classList.toggle('modal-open');
            document.documentElement.classList.toggle('modal-open');
        });

        // Dropdown toggle (Mobile Accordion + Tablet Click-to-Open)
        let lastTap = 0;
        navLinks.querySelectorAll('.dropdown-toggle').forEach(toggle => {
            // Dynamically append visual arrow button if not present
            let arrowBtn = toggle.querySelector('.arrow-btn');
            if (!arrowBtn) {
                arrowBtn = document.createElement('span');
                arrowBtn.className = 'arrow-btn';
                arrowBtn.innerHTML = '▾';
                toggle.appendChild(arrowBtn);
            }

            toggle.addEventListener('click', (e) => {
                const parent = toggle.parentElement;
                
                if (window.innerWidth <= 850) {
                    const isOpen = parent.classList.contains('active');
                    const clickedArrow = e.target.classList.contains('arrow-btn') || e.target.closest('.arrow-btn');

                    if (!isOpen) {
                        // Closed: any click (text or arrow) expands the menu
                        e.preventDefault();
                        e.stopPropagation();
                        // Close other sibling dropdowns at the SAME level
                        const siblingLevel = parent.parentElement.querySelectorAll(':scope > .nav-item.dropdown, :scope > .dropdown-item.has-sub');
                        siblingLevel.forEach(item => item.classList.remove('active'));
                        parent.classList.add('active');
                    } else {
                        // Open:
                        if (clickedArrow) {
                            // Clicking the arrow collapses it
                            e.preventDefault();
                            e.stopPropagation();
                            parent.classList.remove('active');
                        } else {
                            // Clicking the text title navigates to page
                            const href = toggle.getAttribute('href');
                            if (href === '#' || !href) {
                                e.preventDefault();
                                parent.classList.remove('active');
                            } else {
                                closeMobileMenu();
                            }
                        }
                    }
                } else {
                    if (e.pointerType === 'touch') {
                        if (!parent.classList.contains('active')) {
                            e.preventDefault();
                            e.stopPropagation();
                            navLinks.querySelectorAll('.nav-item.dropdown').forEach(item => item.classList.remove('active'));
                            parent.classList.add('active');
                        }
                    }
                }
            });
        });

        // Add handler for Sub-Toggles (like 'Collections') in Mobile Menu
        navLinks.querySelectorAll('.dropdown-item.has-sub').forEach(parent => {
            parent.addEventListener('click', (e) => {
                if (window.innerWidth <= 850) {
                    // Prevent clicks inside the nested sub-dropdown from triggering a toggle collapse
                    if (e.target.closest('.sub-dropdown')) return;

                    e.preventDefault();
                    e.stopPropagation();
                    parent.classList.toggle('active');
                }
            });
        });

        // Simple link handler for ALL mobile links including nested ones
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (e) => {
                if (window.innerWidth <= 850) {
                    // 1. If it's a dropdown toggle, handle it elsewhere
                    if (link.classList.contains('dropdown-toggle')) return;

                    // 2. If it's a regular link, close menu and let it navigate
                    const href = link.getAttribute('href');
                    if (href && !href.includes('#')) {
                        // Regular page link (e.g., collection.html)
                        // Just close menu, don't preventDefault
                        closeMobileMenu();
                    } else if (href && href.includes('#')) {
                        // In-page anchor link (either #id or index.html#id)
                        const targetId = href.split('#')[1];
                        const targetElement = document.getElementById(targetId);
                        
                        if (targetElement) {
                            e.preventDefault();
                            closeMobileMenu();
                            
                            // Let the mobile menu close animation conclude first
                            setTimeout(() => {
                                const navHeight = document.querySelector('.navbar').offsetHeight;
                                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navHeight;
                                window.scrollTo({ top: targetPosition, behavior: 'smooth' });
                            }, 350);
                        } else if (href.startsWith('#')) {
                            // If target element is missing but it's local hash, close menu anyway
                            closeMobileMenu();
                        }
                    }
                }
            });
        });

        // Close dropdowns when clicking away (Tablet/Desktop)
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.nav-item.dropdown')) {
                navLinks.querySelectorAll('.nav-item.dropdown').forEach(item => item.classList.remove('active'));
            }
        });

        // --- Smart Viewport Detection (Prevent Off-screen Dropdowns) ---
        const dropdowns = document.querySelectorAll('.nav-item.dropdown');
        dropdowns.forEach(dropdown => {
            dropdown.addEventListener('mouseenter', () => {
                const menu = dropdown.querySelector('.dropdown-menu');
                if (!menu) return;

                // Reset before checking
                menu.classList.remove('reverse-align');
                
                // 1. Check Main Dropdown
                const rect = menu.getBoundingClientRect();
                if (rect.right > window.innerWidth) {
                    menu.classList.add('reverse-align');
                }

                // 2. Check Sub-Dropdowns (Flyouts)
                const subMenus = menu.querySelectorAll('.sub-dropdown');
                subMenus.forEach(sub => {
                    const subRect = sub.getBoundingClientRect();
                    // We check if the sub-menu WOULD go off-screen if opened to the right
                    // Since it's hidden, we temporarily show it to measure
                    sub.style.display = 'block';
                    sub.style.visibility = 'hidden';
                    const measureRect = sub.getBoundingClientRect();
                    sub.style.display = '';
                    sub.style.visibility = '';

                    if (measureRect.right > window.innerWidth) {
                        sub.classList.add('reverse-align');
                    } else {
                        sub.classList.remove('reverse-align');
                    }
                });
            });
        });



        function closeMobileMenu() {
            navToggle.classList.remove('active');
            navLinks.classList.remove('active');
            document.body.classList.remove('modal-open');
            document.documentElement.classList.remove('modal-open');
        }
    }

    // Navbar transparency effect on scroll — class toggle avoids mutating layout properties directly
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        let navTicking = false;
        window.addEventListener('scroll', () => {
            if (navTicking) return;
            navTicking = true;
            requestAnimationFrame(() => {
                navbar.classList.toggle('scrolled', window.scrollY > 50);
                navTicking = false;
            });
        }, { passive: true });
    }

    // Testimonial Modal Logic
    const modal = document.getElementById('testimonial-modal');
    const modalImg = document.getElementById('modal-img');
    const modalQuote = document.getElementById('modal-quote');
    const modalName = document.getElementById('modal-name');
    const modalLocation = document.getElementById('modal-location');
    const closeBtn = document.querySelector('.modal-close');
    const testimonialCards = document.querySelectorAll('.testimonial-card');

    // Modal Generic Logic
    const openModal = (modalId) => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('active');
            document.body.classList.add('modal-open');
        }
    };

    const closeModal = () => {
        document.querySelectorAll('.modal-overlay.active').forEach(modal => {
            modal.classList.remove('active');
        });
        document.body.classList.remove('modal-open');
    };

    // Testimonial Specifics (Updated for Dynamic Content)
    const testimonialsGrid = document.getElementById('testimonials-grid');
    if (testimonialsGrid) {
        testimonialsGrid.addEventListener('click', (e) => {
            const card = e.target.closest('.testimonial-card');
            if (!card) return;

            const cardImg = card.querySelector('img');
            const name = card.querySelector('.user-name').textContent;
            const fullText = card.getAttribute('data-full-text');
            const location = card.getAttribute('data-location');

            modalImg.src = cardImg.src;
            modalImg.style.objectPosition = cardImg.style.objectPosition;
            modalImg.style.transform = cardImg.style.transform;
            
            modalQuote.innerHTML = `"${fullText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}"`;
            modalName.textContent = name.replace('— ', '');
            modalLocation.textContent = location;

            openModal('testimonial-modal');
            initSwipeDismiss();
        });
    }

    // === Tinder-Style Swipe Dismiss ===
    function initSwipeDismiss() {
        const modalContainer = document.querySelector('#testimonial-modal .modal-container');
        if (!modalContainer) return;

        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        modalContainer.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            isDragging = true;
            modalContainer.style.transition = 'none'; // Lock transition during drag
        });

        modalContainer.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentX = e.touches[0].clientX - startX;
            
            // Limit vertical scroll if swiping horizontally
            if (Math.abs(currentX) > 10) {
                const rotation = currentX / 20; // Slight rotation effect
                const opacity = 1 - Math.abs(currentX) / 1000;
                modalContainer.style.transform = `translateX(${currentX}px) rotate(${rotation}deg)`;
                modalContainer.style.opacity = opacity;
            }
        });

        modalContainer.addEventListener('touchend', () => {
            isDragging = false;
            modalContainer.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

            if (Math.abs(currentX) > 100) {
                // Fly Away
                const direction = currentX > 0 ? 1000 : -1000;
                modalContainer.style.transform = `translateX(${direction}px) rotate(${direction / 20}deg)`;
                modalContainer.style.opacity = '0';
                
                setTimeout(() => {
                    closeModal('testimonial-modal');
                    // Reset position for next time
                    setTimeout(() => {
                        modalContainer.style.transition = 'none';
                        modalContainer.style.transform = 'translateX(0) rotate(0)';
                        modalContainer.style.opacity = '1';
                    }, 500);
                }, 300);
            } else {
                // Snap Back
                modalContainer.style.transform = 'translateX(0) rotate(0)';
                modalContainer.style.opacity = '1';
            }
            currentX = 0;
        });
    }

    // Privacy Specifics
    const privacyTriggers = document.querySelectorAll('.privacy-trigger');
    if (privacyTriggers.length) {
        privacyTriggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                openModal('privacy-modal');
            });
        });
    }

    // Acknowledgements Specifics
    const acknowledgementsTriggers = document.querySelectorAll('.acknowledgements-trigger');
    if (acknowledgementsTriggers.length) {
        acknowledgementsTriggers.forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.preventDefault();
                openModal('acknowledgements-modal');
            });
        });
    }

    // Secure LinkedIn Link (Fortress Strategy — reversed URL decoded at runtime)
    document.querySelectorAll('.secure-linkedin').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const encoded = link.getAttribute('data-href');
            if (encoded) {
                const url = encoded.split('').reverse().join('');
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        });
    });

    // Global Close Controls
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeModal();
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Gallery Carousel Logic
    window.initCarousel = () => {
        const track = document.querySelector('.carousel-track');
        const container = document.querySelector('.carousel-container');
        const nextButton = document.querySelector('.carousel-arrow.next');
        const prevButton = document.querySelector('.carousel-arrow.prev');

        if (!track || !container || !nextButton || !prevButton) return;

        // Cleanup existing clones if re-initializing
        const existingSlides = Array.from(track.children);
        // Only keep the original slides (non-cloned)
        // If we just loaded from Firestore, there are no clones yet.
        // But if we're re-initializing, we need to be careful.
        
        const originalSlides = Array.from(track.querySelectorAll('.carousel-slide:not(.clone)'));
        track.innerHTML = '';
        originalSlides.forEach(s => {
            s.classList.remove('clone');
            track.appendChild(s);
        });

        const totalSlides = originalSlides.length;
        if (totalSlides === 0) return;

        // Clone slides for infinite effect
        originalSlides.forEach(slide => {
            const clone = slide.cloneNode(true);
            clone.classList.add('clone');
            track.appendChild(clone);
        });

        let currentIndex = 0;
        let isPaused = false;
        let isTransitioning = false;
        const scrollInterval = 4000;
        let currentScale = 1;

        const getOffset = (index) => {
            const slideWidth = 500;
            return index * (slideWidth * currentScale);
        };

        const updateCarousel = (animate = true) => {
            const containerWidth = container.offsetWidth;
            const baseWidth = 2500; // Adjusted to fit exactly 5 images across (500 * 5 = 2500)
            currentScale = containerWidth / baseWidth;
            currentScale = Math.min(1.0, Math.max(0.3, currentScale));

            track.querySelectorAll('.carousel-slide').forEach(slide => {
                slide.style.width = `${500 * currentScale}px`;
                slide.style.height = `${500 * currentScale}px`; // Reduced from 600 for panoramic feel
            });

            if (!animate) {
                track.style.transition = 'none';
            } else {
                track.style.transition = 'transform 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
            }
            track.style.transform = `translateX(-${getOffset(currentIndex)}px)`;
        };

        const handleNext = () => {
            if (isTransitioning) return;
            isTransitioning = true;
            currentIndex++;
            updateCarousel(true);
        };

        const handlePrev = () => {
            if (isTransitioning) return;
            isTransitioning = true;
            if (currentIndex <= 0) {
                currentIndex = totalSlides;
                updateCarousel(false);
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        currentIndex--;
                        updateCarousel(true);
                    });
                });
            } else {
                currentIndex--;
                updateCarousel(true);
            }
        };

        track.addEventListener('transitionend', () => {
            isTransitioning = false;
            if (currentIndex >= totalSlides) {
                currentIndex = 0;
                updateCarousel(false);
            } else if (currentIndex < 0) {
                currentIndex = totalSlides - 1;
                updateCarousel(false);
            }
        });

        // Clear any existing intervals
        if (window.carouselInterval) clearInterval(window.carouselInterval);
        window.carouselInterval = setInterval(() => {
            if (!isPaused && !isTransitioning) handleNext();
        }, scrollInterval);

        nextButton.addEventListener('click', () => {
            handleNext();
            isPaused = true;
            setTimeout(() => isPaused = false, 8000);
        });

        prevButton.addEventListener('click', () => {
            handlePrev();
            isPaused = true;
            setTimeout(() => isPaused = false, 8000);
        });

        window.addEventListener('resize', () => updateCarousel(false));
        updateCarousel(false);
    };

    // Mobile 2x2 Grid Endless Transitions Logic
    window.initMobileGrid = (images) => {
        const mobileGrid = document.getElementById('mobile-gallery-grid');
        if (!mobileGrid || !images || images.length < 4) return;

        // Clear any existing mobile grid interval
        if (window.mobileGridInterval) clearInterval(window.mobileGridInterval);

        let currentBatchIndex = 0;
        const displayInterval = 5000;    // ms (time between transitions)
        const staggerDelay = 200;        // ms (stagger effect between cells)
        const fadeOutDuration = 600;     // ms (must match CSS transition speed)

        const cells = Array.from(mobileGrid.querySelectorAll('.mobile-grid-cell'));

        // Pre-load the very first next batch immediately in the background
        const preloadNextBatch = (batchIndex) => {
            const nextBatch = (batchIndex + 4) % images.length;
            for (let i = 0; i < 4; i++) {
                const idx = (nextBatch + i) % images.length;
                const img = new Image();
                img.src = images[idx].url;
            }
        };
        preloadNextBatch(currentBatchIndex);

        // Fade-in the grid container only after initial images are explicitly bound.
        // This prevents cached/stale images from flashing on Safari page refresh.
        cells.forEach((cell, i) => {
            const img = cell.querySelector('.current-img');
            if (img) {
                const imgData = images[i % images.length];
                const focal = imgData.focal || { x: 50, y: 50 };
                const scale = imgData.scale || 1.0;
                img.src = imgData.url;
                img.style.objectPosition = `${focal.x}% ${focal.y}%`;
                img.style.transform = `scale(${scale}) translate3d(0,0,0)`;
            }
        });
        // Allow one paint frame so the browser commits the correct images, then reveal
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                mobileGrid.style.opacity = '1';
            });
        });

        window.mobileGridInterval = setInterval(() => {
            const nextBatchIndex = (currentBatchIndex + 4) % images.length;

            cells.forEach((cell, i) => {
                const currentImgElement = cell.querySelector('.current-img');
                if (!currentImgElement) return;

                const nextIndex = (nextBatchIndex + i) % images.length;
                const nextImgData = images[nextIndex];
                const nextFocal = nextImgData.focal || { x: 50, y: 50 };
                const nextScale = nextImgData.scale || 1.0;

                // Transparent 1x1 spacer to purge GPU frame buffers of the old image
                const SPACER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

                // Step 1: Fade to black with stagger
                setTimeout(() => {
                    currentImgElement.classList.add('fade-out');

                    // Step 2: Once fully faded to black, purge the old image from GPU memory
                    setTimeout(() => {
                        // Force the GPU to erase the old asset — renders pure black if there's any lag
                        currentImgElement.src = SPACER;

                        // Step 3: Assign the new image URL and styling
                        currentImgElement.style.objectPosition = `${nextFocal.x}% ${nextFocal.y}%`;
                        currentImgElement.style.transform = `scale(${nextScale}) translate3d(0,0,0)`;

                        // Step 4: Wait for the browser to confirm the new image is fully decoded
                        // and GPU-ready via native .onload before fading in
                        const fadeIn = () => {
                            currentImgElement.classList.remove('fade-out');
                        };

                        // Safety fallback: if onload doesn't fire (e.g. broken URL), fade in anyway
                        const safetyTimeout = setTimeout(fadeIn, 2000);

                        currentImgElement.onload = () => {
                            clearTimeout(safetyTimeout);
                            // One extra rAF to let the GPU commit the decoded pixels to the compositor
                            requestAnimationFrame(() => {
                                fadeIn();
                            });
                        };

                        currentImgElement.src = nextImgData.url;

                    }, fadeOutDuration);

                }, i * staggerDelay);
            });

            currentBatchIndex = nextBatchIndex;
            // Pre-load the upcoming batch for the next interval cycle
            preloadNextBatch(currentBatchIndex);
        }, displayInterval);
    };

    // Auto-trigger if images were loaded before this script executed
    if (window.mobileGridImages) {
        window.initMobileGrid(window.mobileGridImages);
    }




    // Audio Player & Slideshow Logic
    const audio = document.getElementById('dean-audio');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const centerPlayBtn = document.getElementById('center-play-btn');
    const seekBar = document.getElementById('seek-bar');
    const volumeBar = document.getElementById('volume-bar');
    const volumeBtn = document.getElementById('volume-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const currentTimeDisplay = document.querySelector('.current-time');
    const durationDisplay = document.querySelector('.duration-time');
    const ccBtn = document.getElementById('cc-btn');
    const slideshow = document.getElementById('slideshow');
    const slideshowOverlay = document.querySelector('.slideshow-overlay');
    const subtitlesDisplay = document.getElementById('subtitles-display');
    const playerWrapper = document.querySelector('.audio-player-wrapper');
    
    const iconPlay = document.querySelector('.icon-play');
    const iconPause = document.querySelector('.icon-pause');
    const iconPlayCenter = document.querySelector('.icon-play-center');
    const iconPauseCenter = document.querySelector('.icon-pause-center');
    const iconVolume = document.querySelector('.icon-volume');
    const iconMute = document.querySelector('.icon-mute');
    
    if (audio && playPauseBtn) {
        let subtitlesEnabled = false;
        let mobileControlsTimeout;
        let lastVolume = 1;
        let placeholder = null;

        const formatTime = (time) => {
            if (isNaN(time)) return "0:00";
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60);
            return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
        };

        const updateUI = () => {
            if (audio.paused) {
                iconPlay.classList.remove('hidden');
                iconPause.classList.add('hidden');
                iconPlayCenter.classList.remove('hidden');
                iconPauseCenter.classList.add('hidden');
                
                // Show center play button immediately when paused
                centerPlayBtn.classList.remove('hidden');
                centerPlayBtn.style.opacity = '1';
                centerPlayBtn.style.visibility = 'visible';
                centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1)';
                
                slideshow.classList.add('paused');
            } else {
                iconPlay.classList.add('hidden');
                iconPause.classList.remove('hidden');
                iconPlayCenter.classList.add('hidden');
                iconPauseCenter.classList.remove('hidden');
                
                if (!('ontouchstart' in window)) {
                    centerPlayBtn.classList.add('hidden');
                } else {
                    // On touch devices, automatically fade it out cleanly after 2 seconds
                    resetMobileControlsTimer();
                }
                
                slideshow.classList.add('playing');
                slideshow.classList.remove('paused');
            }
        };

        const resetMobileControlsTimer = () => {
            clearTimeout(mobileControlsTimeout);
            mobileControlsTimeout = setTimeout(() => {
                if (!audio.paused) {
                    // Smoothly fade out the button
                    centerPlayBtn.style.opacity = '0';
                    centerPlayBtn.style.visibility = 'hidden';
                    centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(0.8)';
                    // After the 300ms transition, add hidden class
                    setTimeout(() => {
                        if (audio.paused) return; // Keep it if paused
                        if (centerPlayBtn.style.opacity === '0') {
                            centerPlayBtn.classList.add('hidden');
                        }
                    }, 300);
                }
            }, 2000); // 2 seconds of inactivity
        };

        const handleOverlayInteraction = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            
            const isTouch = e && (e.type === 'touchstart' || e.pointerType === 'touch' || ('ontouchstart' in window));
            
            // Instantly toggle playback state exactly as requested
            togglePlay(e);
            
            if (isTouch) {
                // Mobile/Touch behavior: Smoothly fade in the play/pause icon button to show transition
                centerPlayBtn.classList.remove('hidden');
                // Force reflow
                void centerPlayBtn.offsetWidth;
                centerPlayBtn.style.opacity = '1';
                centerPlayBtn.style.visibility = 'visible';
                centerPlayBtn.style.transform = 'translate(-50%, -50%) scale(1)';
                
                resetMobileControlsTimer();
            }
        };

        const togglePlay = (e) => {
            if (e) e.stopPropagation();
            if (audio.paused) {
                audio.play();
            } else {
                audio.pause();
            }
            updateUI();
        };

        // Hybrid Native + Class-based Expansion Logic for 100% Mobile Reliability
        const toggleFullscreen = () => {
            const isFullscreenActive = playerWrapper.classList.contains('expanded');
            const parentCard = playerWrapper.closest('.video-container');
            const isMobile = window.innerWidth <= 768;
            
            if (isMobile) {
                if (!isFullscreenActive) {
                    // 1. Get initial dimensions and coordinates
                    const rect = playerWrapper.getBoundingClientRect();
                    
                    // 2. Insert placeholder to maintain inline space and prevent text/page layout jump
                    if (!placeholder) {
                        placeholder = document.createElement('div');
                        placeholder.className = 'player-placeholder';
                        placeholder.style.width = `${rect.width}px`;
                        placeholder.style.height = `${rect.height}px`;
                        placeholder.style.aspectRatio = '16/9';
                        placeholder.style.borderRadius = '12px';
                        playerWrapper.parentNode.insertBefore(placeholder, playerWrapper);
                    }
                    
                    // 3. Freeze player in place using fixed positioning at initial inline coordinates
                    playerWrapper.style.setProperty('position', 'fixed', 'important');
                    playerWrapper.style.setProperty('top', `${rect.top}px`, 'important');
                    playerWrapper.style.setProperty('left', `${rect.left}px`, 'important');
                    playerWrapper.style.setProperty('width', `${rect.width}px`, 'important');
                    playerWrapper.style.setProperty('height', `${rect.height}px`, 'important');
                    playerWrapper.style.setProperty('border-radius', '12px', 'important');
                    playerWrapper.style.setProperty('z-index', '99999', 'important');
                    playerWrapper.style.setProperty('margin', '0', 'important');
                    
                    // Force a layout reflow so the browser caches starting positions
                    playerWrapper.offsetHeight;
                    
                    // 4. Trigger the expansion morph with hardware-accelerated transition
                    playerWrapper.style.setProperty('transition', 'all 0.4s cubic-bezier(0.25, 1, 0.5, 1)', 'important');
                    playerWrapper.style.setProperty('top', '0px', 'important');
                    playerWrapper.style.setProperty('left', '0px', 'important');
                    playerWrapper.style.setProperty('width', '100vw', 'important');
                    playerWrapper.style.setProperty('height', '100dvh', 'important');
                    playerWrapper.style.setProperty('border-radius', '0px', 'important');
                    
                    playerWrapper.classList.add('expanded');
                    document.body.classList.add('player-expanded');
                    if (parentCard) {
                        parentCard.classList.add('expanded-parent');
                    }
                } else {
                    // 1. Get target coordinates from placeholder
                    if (placeholder) {
                        const targetRect = placeholder.getBoundingClientRect();
                        
                        // 2. Animate player wrapper back to its inline placeholder coordinates
                        playerWrapper.style.setProperty('top', `${targetRect.top}px`, 'important');
                        playerWrapper.style.setProperty('left', `${targetRect.left}px`, 'important');
                        playerWrapper.style.setProperty('width', `${targetRect.width}px`, 'important');
                        playerWrapper.style.setProperty('height', `${targetRect.height}px`, 'important');
                        playerWrapper.style.setProperty('border-radius', '12px', 'important');
                    }
                    
                    playerWrapper.classList.remove('expanded');
                    if (parentCard) {
                        parentCard.classList.remove('expanded-parent');
                    }
                    
                    // 3. Wait for the 400ms transition to complete, then clean up inline styles and placeholder
                    setTimeout(() => {
                        playerWrapper.style.removeProperty('position');
                        playerWrapper.style.removeProperty('top');
                        playerWrapper.style.removeProperty('left');
                        playerWrapper.style.removeProperty('width');
                        playerWrapper.style.removeProperty('height');
                        playerWrapper.style.removeProperty('border-radius');
                        playerWrapper.style.removeProperty('transition');
                        playerWrapper.style.removeProperty('z-index');
                        playerWrapper.style.removeProperty('margin');
                        
                        if (placeholder) {
                            placeholder.remove();
                            placeholder = null;
                        }
                        document.body.classList.remove('player-expanded');
                    }, 400);
                }
            } else {
                // Desktop standard fullscreen flow
                const isNativeActive = document.fullscreenElement || document.webkitFullscreenElement;
                if (!isNativeActive) {
                    playerWrapper.classList.add('expanded');
                    document.body.classList.add('player-expanded');
                    if (parentCard) {
                        parentCard.classList.add('expanded-parent');
                    }
                    if (playerWrapper.requestFullscreen) {
                        playerWrapper.requestFullscreen().catch(err => {
                            console.log("Native fullscreen request rejected:", err.message);
                        });
                    } else if (playerWrapper.webkitRequestFullscreen) {
                        playerWrapper.webkitRequestFullscreen();
                    }
                } else {
                    playerWrapper.classList.remove('expanded');
                    if (parentCard) {
                        parentCard.classList.remove('expanded-parent');
                    }
                    setTimeout(() => {
                        document.body.classList.remove('player-expanded');
                    }, 400);
                    if (document.exitFullscreen) {
                        document.exitFullscreen().catch(err => {});
                    } else if (document.webkitExitFullscreen) {
                        document.webkitExitFullscreen();
                    }
                }
            }
        };

        // Listen for native fullscreen changes to sync fallback classes
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement) {
                playerWrapper.classList.remove('expanded');
                const parentCard = playerWrapper.closest('.video-container');
                if (parentCard) {
                    parentCard.classList.remove('expanded-parent');
                }
                setTimeout(() => {
                    document.body.classList.remove('player-expanded');
                }, 400);
            }
        });
        document.addEventListener('webkitfullscreenchange', () => {
            if (!document.webkitIsFullScreen) {
                playerWrapper.classList.remove('expanded');
                const parentCard = playerWrapper.closest('.video-container');
                if (parentCard) {
                    parentCard.classList.remove('expanded-parent');
                }
                setTimeout(() => {
                    document.body.classList.remove('player-expanded');
                }, 400);
            }
        });

        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFullscreen();
            });
        }

        // Volume Logic
        volumeBar.addEventListener('input', () => {
            audio.volume = volumeBar.value;
            lastVolume = audio.volume;
            if (audio.volume === 0) {
                audio.muted = true;
                iconVolume.classList.add('hidden');
                iconMute.classList.remove('hidden');
            } else {
                audio.muted = false;
                iconVolume.classList.remove('hidden');
                iconMute.classList.add('hidden');
            }
        });

        const toggleMute = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            audio.muted = !audio.muted;
            if (audio.muted) {
                iconVolume.classList.add('hidden');
                iconMute.classList.remove('hidden');
                volumeBar.value = 0;
            } else {
                iconVolume.classList.remove('hidden');
                iconMute.classList.add('hidden');
                volumeBar.value = lastVolume || 1;
                try {
                    audio.volume = lastVolume || 1;
                } catch (err) {
                    console.log("Volume adjustment not supported on this platform:", err.message);
                }
            }
        };

        volumeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMute(e);
        });

        // Setup unified interaction listeners on slideshow overlay
        slideshowOverlay.addEventListener('click', (e) => {
            if (!('ontouchstart' in window)) {
                handleOverlayInteraction(e);
            }
        });
        
        slideshowOverlay.addEventListener('touchstart', (e) => {
            handleOverlayInteraction(e);
        }, { passive: false });

        // Setup interaction listeners on center play button (instant, no double-firing)
        centerPlayBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePlay(e);
            if ('ontouchstart' in window) {
                resetMobileControlsTimer();
            }
        });

        centerPlayBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePlay(e);
            resetMobileControlsTimer();
        }, { passive: false });

        playPauseBtn.addEventListener('click', togglePlay);

        audio.addEventListener('play', updateUI);
        audio.addEventListener('pause', updateUI);

        let isDragging = false;

        // Seek Bar Total Lockdown Fix
        let isSeeking = false;

        audio.addEventListener('timeupdate', () => {
            if (!isSeeking) {
                seekBar.value = audio.currentTime;
                currentTimeDisplay.textContent = formatTime(audio.currentTime);
            }
        });

        const startSeek = () => { isSeeking = true; };
        const endSeek = () => {
            if (isSeeking) {
                audio.currentTime = seekBar.value;
                isSeeking = false;
            }
        };

        seekBar.addEventListener('mousedown', startSeek);
        seekBar.addEventListener('touchstart', startSeek, { passive: true });
        
        seekBar.addEventListener('input', () => {
            currentTimeDisplay.textContent = formatTime(seekBar.value);
        });

        window.addEventListener('mouseup', endSeek);
        window.addEventListener('touchend', endSeek);

        seekBar.addEventListener('change', endSeek);

        audio.addEventListener('ended', () => {
            updateUI();
            seekBar.value = 0;
            audio.currentTime = 0;
        });

        audio.addEventListener('loadedmetadata', () => {
            durationDisplay.textContent = formatTime(audio.duration);
            seekBar.max = audio.duration;
        });

        // Immediate Sync in case already loaded
        if (audio.readyState >= 1) {
            durationDisplay.textContent = formatTime(audio.duration);
            seekBar.max = audio.duration;
        }

        // Subtitles Logic
        const setupSubtitles = () => {
            // Remove existing tracks to avoid duplicates
            for (let i = 0; i < audio.textTracks.length; i++) {
                audio.textTracks[i].mode = 'disabled';
            }

            const track = audio.textTracks[0];
            if (track) {
                track.mode = 'hidden';
                track.oncuechange = () => {
                    if (!subtitlesEnabled) return;
                    const activeCues = track.activeCues;
                    if (activeCues && activeCues.length > 0) {
                        subtitlesDisplay.innerHTML = `<span>${activeCues[0].text}</span>`;
                    } else {
                        subtitlesDisplay.innerHTML = '';
                    }
                };
            }
        };

        setupSubtitles();
        audio.addEventListener('loadedmetadata', setupSubtitles);
        // Also listen for src changes (when we inject the blob)
        const trackEl = document.getElementById('audio-subtitles');
        if (trackEl) {
            trackEl.addEventListener('load', () => {
                // Force track re-index
                setupSubtitles();
            });
        }

        ccBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            subtitlesEnabled = !subtitlesEnabled;
            if (subtitlesEnabled) {
                ccBtn.classList.remove('cc-off');
                ccBtn.classList.add('cc-on');
                const track = audio.textTracks[0];
                if (track && track.activeCues && track.activeCues.length > 0) {
                    subtitlesDisplay.innerHTML = `<span>${track.activeCues[0].text}</span>`;
                }
            } else {
                ccBtn.classList.add('cc-off');
                ccBtn.classList.remove('cc-on');
                subtitlesDisplay.innerHTML = '';
            }
        });
    }


    // --- Testimonial Slider System ---
    window.initializeTestimonialSlider = function() {
        const track = document.getElementById('testimonials-grid');
        const dotsContainer = document.getElementById('testimonials-dots');
        const prevBtn = document.querySelector('.t-prev');
        const nextBtn = document.querySelector('.t-next');
        
        if (!track || !dotsContainer) return;

        // Clean up any previous clones or listeners if re-initializing
        const originalCards = Array.from(track.querySelectorAll('.testimonial-card:not(.t-clone)'));
        if (originalCards.length === 0) return;

        track.innerHTML = '';
        originalCards.forEach(card => track.appendChild(card));

        // Dynamically compute how many cards are visible
        const cardsVisible = window.innerWidth <= 768 ? 1 : 3;
        const totalOriginals = originalCards.length;
        
        // Only loop if we have more than visible cards
        if (totalOriginals <= cardsVisible) {
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
            dotsContainer.style.display = 'none';
            return;
        } else {
            prevBtn.style.display = 'flex';
            nextBtn.style.display = 'flex';
            dotsContainer.style.display = 'flex';
        }

        // Clone first few and last few for seamless loop
        for (let i = 0; i < cardsVisible; i++) {
            const cloneFirst = originalCards[i].cloneNode(true);
            cloneFirst.classList.add('t-clone');
            track.appendChild(cloneFirst);

            const cloneLast = originalCards[totalOriginals - 1 - i].cloneNode(true);
            cloneLast.classList.add('t-clone');
            track.insertBefore(cloneLast, track.firstChild);
        }

        const allCards = Array.from(track.children);
        let currentIndex = cardsVisible; // Start at the first original card
        if (cardsVisible === 1) {
            const ailsaIndex = originalCards.findIndex(card => {
                const nameEl = card.querySelector('.user-name');
                return nameEl && nameEl.textContent.includes('Ailsa Watson');
            });
            if (ailsaIndex !== -1) {
                currentIndex = ailsaIndex + cardsVisible;
            }
        }
        let isTransitioning = false;

        // Create 1 Dot per Original Card
        dotsContainer.innerHTML = '';
        for (let i = 0; i < totalOriginals; i++) {
            const dot = document.createElement('button');
            dot.className = `t-dot ${i === 0 ? 'active' : ''}`;
            dot.addEventListener('click', () => {
                if (isTransitioning) return;
                currentIndex = i + cardsVisible;
                updateSlider(true);
            });
            dotsContainer.appendChild(dot);
        }

        function updateSlider(animate = true) {
            if (!animate) {
                track.style.transition = 'none';
            } else {
                track.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
                isTransitioning = true;
            }

            const cardWidth = originalCards[0].offsetWidth;
            const gap = parseInt(window.getComputedStyle(track).gap) || 0;
            const moveAmount = currentIndex * (cardWidth + gap);
            
            track.style.transform = `translateX(-${moveAmount}px)`;
            
            // Update Focus State (Middle Card on Desktop, Active Card on Mobile)
            const focusOffset = cardsVisible === 3 ? 1 : 0;
            allCards.forEach((card, i) => {
                card.classList.toggle('focused', i === currentIndex + focusOffset);
            });

            // Update Dots
            const dotIndex = (currentIndex - cardsVisible + totalOriginals) % totalOriginals;
            document.querySelectorAll('.t-dot').forEach((dot, i) => {
                dot.classList.toggle('active', i === dotIndex);
            });
        }

        track.addEventListener('transitionend', () => {
            isTransitioning = false;
            // Handle Seamless Jump
            if (currentIndex >= totalOriginals + cardsVisible) {
                currentIndex = cardsVisible;
                updateSlider(false);
            } else if (currentIndex < cardsVisible) {
                currentIndex = totalOriginals + cardsVisible - 1;
                updateSlider(false);
            }
        });

        nextBtn.addEventListener('click', () => {
            if (isTransitioning) return;
            currentIndex++;
            updateSlider(true);
        });

        prevBtn.addEventListener('click', () => {
            if (isTransitioning) return;
            currentIndex--;
            updateSlider(true);
        });

        // Touch/Swipe Support for Mobile
        let touchStartX = 0;
        let touchEndX = 0;
        
        if (!track._touchBound) {
            track.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });
            
            track.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                handleSwipe();
            }, { passive: true });
            
            track._touchBound = true;
        }
        
        function handleSwipe() {
            const threshold = 50; // Minimum swipe distance in pixels
            if (touchStartX - touchEndX > threshold) {
                // Swipe Left -> Next Card
                if (isTransitioning) return;
                currentIndex++;
                updateSlider(true);
            } else if (touchEndX - touchStartX > threshold) {
                // Swipe Right -> Previous Card
                if (isTransitioning) return;
                currentIndex--;
                updateSlider(true);
            }
        }

        // Clean, smart resize handling
        let lastCardsVisible = cardsVisible;
        const handleResize = () => {
            const currentCardsVisible = window.innerWidth <= 768 ? 1 : 3;
            if (currentCardsVisible !== lastCardsVisible) {
                lastCardsVisible = currentCardsVisible;
                window.initializeTestimonialSlider(); // Re-initialize completely
            } else {
                updateSlider(false);
            }
        };

        window.removeEventListener('resize', window._testimonialResizeHandler);
        window._testimonialResizeHandler = handleResize;
        window.addEventListener('resize', window._testimonialResizeHandler);
        
        // Initial Snap to first original
        updateSlider(false);
    };

    // GoatCounter Privacy-First Analytics (Zero-Cookie, Identity-less)
    const allowedHosts = [
        'deansafaris.com', 
        'mcgregorsafaris.com', 
        'deansafaris.web.app', 
        'mcgregorsafaris.web.app',
        'deanmcgregorsafaris.com',
        'www.deanmcgregorsafaris.com',
        'deanmcgregorsafaris-live.web.app',
        'deanmcgregorsafaris-live.firebaseapp.com'
    ];
    if (allowedHosts.includes(window.location.hostname) || window.location.hostname.endsWith('.web.app') || window.location.hostname.endsWith('.firebaseapp.com')) {
        const script = document.createElement('script');
        let goatcounterCode = 'deansafaris';
        if (window.location.hostname.includes('deanmcgregorsafaris') || window.location.hostname.includes('mcgregorsafaris')) {
            goatcounterCode = 'deanmcgregorsafaris';
        } else if (window.location.hostname.includes('deantest-abc')) {
            goatcounterCode = 'deantest-abc';
        } else if (window.location.hostname.includes('deanstesthandover')) {
            goatcounterCode = 'deanstesthandover';
        }
        script.dataset.goatcounter = `https://${goatcounterCode}.goatcounter.com/count`;
        script.async = true;
        script.src = '//gc.zgo.at/count.js';
        document.body.appendChild(script);
    }

    // Knowledge Trigger Modal Popover handling on Mobile
    const knowledgeTrigger = document.querySelector('.knowledge-trigger');
    const bioParagraph = document.querySelector('.bio-paragraph');
    const popover = knowledgeTrigger ? knowledgeTrigger.querySelector('.knowledge-popover') : null;

    if (knowledgeTrigger && bioParagraph && popover) {
        let touchStartPos = { x: 0, y: 0 };
        let isDragging = false;

        const positionPopover = () => {
            if (window.innerWidth <= 1024) {
                const triggerRect = knowledgeTrigger.getBoundingClientRect();
                
                // Get the scroll container / scroll-offset context safely
                const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
                const scrollY = window.pageYOffset || document.documentElement.scrollTop;
                
                // Calculate absolute coordinates inside the viewport/page context
                const absoluteTriggerTop = triggerRect.top + scrollY;
                const absoluteTriggerLeft = triggerRect.left + scrollX;
                
                const popoverWidth = Math.min(300, window.innerWidth - 24);
                popover.style.width = `${popoverWidth}px`;
                
                // Find desired horizontal screen centre coordinate in page context
                const desiredPageLeft = scrollX + (window.innerWidth - popoverWidth) / 2;
                
                // Since popover is absolutely positioned within the relative trigger text:
                // popover relative left = desired absolute left - trigger absolute left
                const relativeLeft = desiredPageLeft - absoluteTriggerLeft;
                
                // Place it 10px below the trigger text box bottom
                const relativeTop = triggerRect.height + 10;
                
                popover.style.top = `${relativeTop}px`;
                popover.style.left = `${relativeLeft}px`;
                popover.style.transform = 'none'; // Clear the translate transforms
            } else {
                // Reset to CSS defaults on desktop
                popover.style.top = '';
                popover.style.left = '';
                popover.style.width = '';
                popover.style.transform = '';
            }
        };

        // Open on click (taps) on mobile
        knowledgeTrigger.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024) {
                e.preventDefault();
                e.stopPropagation();
                
                const isActive = knowledgeTrigger.classList.contains('active');
                if (!isActive) {
                    positionPopover();
                    // Double check layout sizing context
                    requestAnimationFrame(() => {
                        positionPopover();
                    });
                    knowledgeTrigger.classList.add('active');
                } else {
                    knowledgeTrigger.classList.remove('active');
                }
            }
        });

        // Touch gesture tracking to distinguish tap from drag scroll
        document.addEventListener('touchstart', (e) => {
            if (!knowledgeTrigger.classList.contains('active')) return;
            
            touchStartPos = {
                x: e.touches[0].clientX,
                y: e.touches[0].clientY
            };
            isDragging = false;
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!knowledgeTrigger.classList.contains('active')) return;
            
            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const dist = Math.hypot(currentX - touchStartPos.x, currentY - touchStartPos.y);
            
            // If they drag more than 8px, flag as dragging to preserve popover open state
            if (dist > 8) {
                isDragging = true;
            }
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            if (!knowledgeTrigger.classList.contains('active')) return;
            
            // Keep dragging state active briefly to absorb the subsequent 'click' event
            if (isDragging) {
                setTimeout(() => {
                    isDragging = false;
                }, 150);
            }
        }, { passive: true });

        // Single robust close listener that handles click & tap
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024 && knowledgeTrigger.classList.contains('active')) {
                // If they were dragging/scrolling, ignore this click event!
                if (isDragging) return;

                if (!knowledgeTrigger.contains(e.target) && !popover.contains(e.target)) {
                    knowledgeTrigger.classList.remove('active');
                }
            }
        });

        // Tapping inside the popover is safe and does not close it
        popover.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        window.addEventListener('resize', positionPopover);
    }
});
