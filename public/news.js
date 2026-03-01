/**
 * Daily News Module - Frontend Script
 * OpenClaw Mission Control
 */

// DOM Elements
const newsDateInput = document.getElementById('news-date');
const syncBtn = document.getElementById('sync-btn');
const globalNewsContainer = document.getElementById('global-news');
const techNewsContainer = document.getElementById('tech-news');
const aiNewsContainer = document.getElementById('ai-news');
const globalCount = document.getElementById('global-count');
const techCount = document.getElementById('tech-count');
const aiCount = document.getElementById('ai-count');
const velocityValue = document.getElementById('velocity-value');
const velocityFill = document.getElementById('velocity-fill');
const apiStatus = document.getElementById('api-status');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initDatePicker();
    loadNews();
    initSyncButton();
});

// Initialize date picker using Flatpickr and restrict available dates
async function initDatePicker() {
    const today = new Date().toISOString().split('T')[0];
    newsDateInput.value = today;

    // Fetch allowed dates from the backend
    let availableDates = [today];
    try {
        const response = await fetch('/api/news/dates');
        if (response.ok) {
            availableDates = await response.json();
        }
    } catch (e) {
        console.error('Failed to load historical dates:', e);
    }

    // Attach Flatpickr
    flatpickr(newsDateInput, {
        defaultDate: today,
        enable: availableDates,
        dateFormat: "Y-m-d",
        onChange: function (selectedDates, dateStr, instance) {
            loadNews(dateStr);
        }
    });
}

// Initialize sync button
function initSyncButton() {
    syncBtn.addEventListener('click', () => {
        syncBtn.classList.add('syncing');
        syncBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';

        // Force refresh news
        loadNews(newsDateInput.value, true).then(() => {
            setTimeout(() => {
                syncBtn.classList.remove('syncing');
            }, 1000);
        });
    });
}

// Load news for a specific date
async function loadNews(date = null, forceRefresh = false) {
    if (!date) {
        date = new Date().toISOString().split('T')[0];
    }

    showLoading();

    try {
        const url = forceRefresh
            ? `/api/news?date=${date}&refresh=true`
            : `/api/news?date=${date}`;

        const response = await fetch(url);

        if (response.ok) {
            const data = await response.json();
            renderNews(data);
            updateVelocity(85 + Math.random() * 15);
            apiStatus.textContent = 'Connected';
            apiStatus.classList.add('connected');
        } else {
            throw new Error('API error');
        }
    } catch (error) {
        console.error('Failed to load news:', error);
        apiStatus.textContent = 'Disconnected';
        apiStatus.classList.remove('connected');
        // Load sample data as fallback
        renderNews(getSampleNews());
    }
}

// Show loading state
function showLoading() {
    const loadingHTML = `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <span>Loading intelligence...</span>
        </div>
    `;
    globalNewsContainer.innerHTML = loadingHTML;
    techNewsContainer.innerHTML = loadingHTML;
    aiNewsContainer.innerHTML = loadingHTML;
}

let currentNewsData = { global: [], tech: [], ai: [] };
let paginationState = {
    global: { page: 1, limit: 3 },
    tech: { page: 1, limit: 3 },
    ai: { page: 1, limit: 3 }
};

// Render news to containers
function renderNews(data) {
    if (data) {
        currentNewsData = data;
        paginationState.global.page = 1;
        paginationState.tech.page = 1;
        paginationState.ai.page = 1;
    }

    renderColumn('global', globalNewsContainer, globalCount, 'REPORTS');
    renderColumn('tech', techNewsContainer, techCount, 'LOCAL');
    renderColumn('ai', aiNewsContainer, aiCount, 'TRENDING: ', true);
}

function renderColumn(type, container, countEl, countSuffix, isAI = false) {
    const items = currentNewsData[type] || [];
    const pState = paginationState[type];

    // Render items inside a scrollable container
    if (items.length > 0) {
        const visibleItems = isAI ? items : items.slice(0, pState.page * pState.limit);
        let html = visibleItems.map(item => createNewsCard(item, isAI)).join('');
        container.innerHTML = `<div class="scrollable-feed" id="feed-${type}" onscroll="handleScroll('${type}')">${html}</div>`;

        let countText = isAI ? `${countSuffix}${items.length}` : (type === 'tech' ? `${String(items.length).padStart(2, '0')} ${countSuffix}` : `${items.length} ${countSuffix}`);
        countEl.textContent = countText;

    } else {
        container.innerHTML = `<div class="empty-state">
                <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" style="margin-bottom: 8px;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>NO DATA ARCHIVED</span>
                <span style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Historical feed unavailable for this date</span>
            </div>`;
        countEl.textContent = `${countSuffix}0`;
    }
}

window.handleScroll = function (type) {
    if (type === 'ai') return; // AI renders all at once currently

    const feed = document.getElementById(`feed-${type}`);
    if (!feed) return;

    // Check if scrolled to bottom (within 20px)
    if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 20) {
        const items = currentNewsData[type] || [];
        const pState = paginationState[type];

        const totalPages = Math.ceil(items.length / pState.limit) || 1;
        if (pState.page < totalPages) {
            pState.page += 1;
            // Re-render column to append new items
            const containers = {
                global: { c: globalNewsContainer, count: globalCount, suffix: 'REPORTS', isAI: false },
                tech: { c: techNewsContainer, count: techCount, suffix: 'LOCAL', isAI: false }
            };
            if (containers[type]) {
                const cData = containers[type];
                renderColumn(type, cData.c, cData.count, cData.suffix, cData.isAI);

                // Maintain scroll position after re-render by giving it a slight delay
                setTimeout(() => {
                    const updatedFeed = document.getElementById(`feed-${type}`);
                    if (updatedFeed) {
                        // Scroll slightly up so it doesn't trigger again instantly
                        // Just enough to show new items
                    }
                }, 0);
            }
        }
    }
};

// Create a news card HTML
function createNewsCard(item, isAI = false) {
    const categoryClass = getCategoryClass(item.category);
    const viralClass = getViralClass(item.viralScore);
    const timestamp = formatTimestamp(item.timestamp || item.date);

    let viewersHTML = '';
    if (item.viewers) {
        viewersHTML = `<span class="viewers-count">${item.viewers} WATCHING</span>`;
    }

    let thumbnailHTML = '';
    if (item.thumbnail) {
        thumbnailHTML = `
            <div class="news-thumbnail">
                <img src="${item.thumbnail}" alt="Thumbnail">
            </div>
        `;
    }

    let descriptionHTML = '';
    if (item.description) {
        descriptionHTML = `
            <p class="news-description">${item.description}</p>
        `;
    }

    return `
        <div class="news-card">
            <div class="news-card-header">
                <span class="news-category ${categoryClass}">${item.category}</span>
                <span class="news-timestamp">${viewersHTML || timestamp}</span>
            </div>
            <h3 class="news-headline">${item.headline}</h3>
            ${thumbnailHTML}
            ${descriptionHTML}
            <div class="news-card-footer">
                <div class="viral-score">
                    <span class="viral-label">VIRAL SCORE</span>
                    <span class="viral-value ${viralClass}">${item.viralScore}/10</span>
                </div>
                <a href="${item.url || '#'}" target="_blank" class="news-link" title="Open article">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>
                    </svg>
                </a>
            </div>
        </div>
    `;
}

// Get category CSS class
function getCategoryClass(category) {
    const map = {
        'BREAKING': 'breaking',
        'POLITICS': 'politics',
        'ECONOMY': 'economy',
        'TECH': 'tech',
        'LIVE STREAM': 'live',
        'SYNTHETIC MEDIA': 'synthetic',
        'AI': 'ai',
        'WORLD': 'world'
    };
    return map[category] || 'tech';
}

// Get viral score class
function getViralClass(score) {
    if (score >= 9) return 'high';
    if (score >= 7) return 'medium';
    return '';
}

// Format timestamp
function formatTimestamp(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${mins} UTC`;
}

// Update velocity meter
function updateVelocity(value) {
    velocityValue.textContent = `${Math.round(value)}%`;
    velocityFill.style.width = `${value}%`;
}

// Sample news data fallback
function getSampleNews() {
    return {
        global: [
            {
                category: 'BREAKING',
                headline: 'Quantum Supremacy: Global Banking Protocol Breach Detected',
                description: 'Unprecedented anomalies detected across global financial networks. Intelligence agencies are investigating potential breaches in core cryptographic protocols. Immediate action is required to secure foundational digital assets across the hemisphere.',
                thumbnail: 'https://images.unsplash.com/photo-1639322537228-f710d846310a?auto=format&fit=crop&q=80&w=400',
                timestamp: new Date().toISOString(),
                viralScore: 9.8,
                url: '#'
            },
            {
                category: 'POLITICS',
                headline: 'Mars Colony Charter Signed by 140 Nations',
                description: 'Leaders from 140 nations convened today to sign the historic Mars Colony Charter, establishing sovereignty rules and resource sharing agreements for extra-planetary settlements in the upcoming decade.',
                thumbnail: 'https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&q=80&w=400',
                timestamp: new Date().toISOString(),
                viralScore: 7.2,
                url: '#'
            },
            {
                category: 'WORLD',
                headline: 'Arctic Digital Infrastructure Hub Announced',
                description: 'A coalition of tech giants has announced plans to build the largest cooling-efficient data center network in the Arctic circle, promising zero-emission computation power to support incoming AI loads.',
                thumbnail: 'https://images.unsplash.com/photo-1541888045-8c764ee7119f?auto=format&fit=crop&q=80&w=400',
                timestamp: new Date().toISOString(),
                viralScore: 6.5,
                url: '#'
            },
            {
                category: 'BREAKING',
                headline: 'European Central Bank Transitions to Fully Digital Currency',
                description: 'The ECB has finalized its five-year transition, phasing out physical cash entirely. The new digital euro system utilizes advanced blockchain technology to ensure instant settlements and robust fraud protection.',
                thumbnail: 'https://images.unsplash.com/photo-1621504450181-5d356f153325?auto=format&fit=crop&q=80&w=400',
                timestamp: new Date().toISOString(),
                viralScore: 8.9,
                url: '#'
            },
            {
                category: 'WORLD',
                headline: 'New Oceanic Clean-up Fleet Recovers 1 Million Tons of Plastic',
                description: 'The autonomous nautical drones deployed last year have hit a major milestone, clearing massive garbage patches in the Pacific and recycling the materials dynamically on board.',
                thumbnail: 'https://images.unsplash.com/photo-1594514578842-feae2d89ae83?auto=format&fit=crop&q=80&w=400',
                timestamp: new Date().toISOString(),
                viralScore: 8.1,
                url: '#'
            }
        ],
        tech: [
            {
                category: 'ECONOMY',
                headline: 'Kuala Lumpur Becomes Southeast Asia\'s Premier AI Hub',
                timestamp: new Date().toISOString(),
                viralScore: 8.5,
                url: '#'
            },
            {
                category: 'TECH',
                headline: 'Penang Semiconductor Corridor Announces Next-Gen Neural Chips',
                timestamp: new Date().toISOString(),
                viralScore: 6.9,
                url: '#'
            },
            {
                category: 'TECH',
                headline: 'OpenAI Releases GPT-5 with Multimodal Reasoning',
                timestamp: new Date().toISOString(),
                viralScore: 9.2,
                url: '#'
            }
        ],
        ai: [
            {
                category: 'LIVE STREAM',
                headline: 'NVIDIA CEO Unveils \'Project Blackwell\' - The Last Human-Designed Architecture?',
                thumbnail: 'https://i.ytimg.com/vi/pGU1W-F7oD0/hq720.jpg',
                timestamp: new Date().toISOString(),
                viralScore: 9.9,
                viewers: '22.4K',
                url: '#'
            },
            {
                category: 'SYNTHETIC MEDIA',
                headline: 'The Rise of AI YouTubers: Why Real Humans are Losing the Algorithm War',
                thumbnail: 'https://i.ytimg.com/vi/-OKcDp2H4eU/hq720.jpg',
                timestamp: new Date().toISOString(),
                viralScore: 8.1,
                url: '#'
            },
            {
                category: 'AI',
                headline: 'Claude 4 Passes Medical Board Exam with 99.7% Accuracy',
                thumbnail: 'https://i.ytimg.com/vi/KldVQBAkjuo/hq720.jpg',
                timestamp: new Date().toISOString(),
                viralScore: 9.4,
                url: '#'
            }
        ]
    };
}

// Periodic velocity animation
setInterval(() => {
    const currentVelocity = parseFloat(velocityValue.textContent);
    const newVelocity = Math.max(70, Math.min(99, currentVelocity + (Math.random() - 0.5) * 5));
    updateVelocity(newVelocity);
}, 3000);
