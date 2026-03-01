const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const app = express();

// Paths
const dbPath = path.resolve(process.cwd(), 'api', 'db.json');
const newsPath = path.resolve(process.cwd(), 'api', 'news-cache.json');
const PORT = process.env.PORT || 3000;

// SERP API Configuration
const SERP_API_KEY = process.env.SERP_API_KEY;

app.use(express.json());

// Serve static files from the public folder for local development
app.use(express.static(path.join(process.cwd(), 'public')));

// API endpoint to serve task data
app.get('/api/tasks', async (req, res) => {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        const jsonData = JSON.parse(data);
        res.status(200).json(jsonData.tasks || []);
    } catch (error) {
        console.error('API ERROR: Failed to read task database:', error);
        res.status(500).json({ error: 'Internal Server Error: Could not retrieve tasks.' });
    }
});

// Patch a task (status/progress/etc)
app.patch('/api/tasks/:id', async (req, res) => {
    try {
        const taskId = String(req.params.id);
        const allowed = new Set(['status', 'progress', 'progressLabel', 'completedAt', 'startedAt']);
        const updates = {};
        for (const [k, v] of Object.entries(req.body || {})) {
            if (allowed.has(k)) updates[k] = v;
        }

        const data = await fs.readFile(dbPath, 'utf8');
        const jsonData = JSON.parse(data);
        const list = jsonData.tasks || [];

        const idx = list.findIndex(t => String(t.id) === taskId);
        if (idx === -1) return res.status(404).json({ error: 'Task not found' });

        list[idx] = { ...list[idx], ...updates };
        jsonData.tasks = list;
        await fs.writeFile(dbPath, JSON.stringify(jsonData, null, 2));

        res.status(200).json(list[idx]);
    } catch (error) {
        console.error('API ERROR: Failed to patch task:', error);
        res.status(500).json({ error: 'Internal Server Error: Could not update task.' });
    }
});

// API endpoint to serve available news dates
app.get('/api/news/dates', async (req, res) => {
    try {
        const cacheData = await fs.readFile(newsPath, 'utf8');
        const newsCache = JSON.parse(cacheData);
        const todayStr = new Date().toISOString().split('T')[0];

        const dates = new Set(Object.keys(newsCache));
        dates.add(todayStr); // Ensure today is always selectable

        const sortedDates = Array.from(dates).sort((a, b) => b.localeCompare(a));
        res.status(200).json(sortedDates);
    } catch (error) {
        // Fallback if cache doesn't exist
        const todayStr = new Date().toISOString().split('T')[0];
        res.status(200).json([todayStr]);
    }
});

// API endpoint to serve news data
app.get('/api/news', async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const requestedDate = req.query.date || todayStr;
        const forceRefresh = req.query.refresh === 'true';

        // Try to load cached news
        let newsCache = {};
        try {
            const cacheData = await fs.readFile(newsPath, 'utf8');
            newsCache = JSON.parse(cacheData);
        } catch (e) {
            newsCache = {};
        }

        // Check if we have cached data for this date
        if (!forceRefresh && newsCache[requestedDate]) {
            return res.status(200).json(newsCache[requestedDate]);
        }

        // If they requested a past date and it's not in the cache, don't fetch today's news for it.
        // Also don't allow future dates, but the frontend restricts that.
        if (requestedDate !== todayStr) {
            return res.status(200).json({ global: [], tech: [], ai: [] });
        }

        // Fetch fresh news from SERP API for today
        if (!SERP_API_KEY) {
            // No API key configured: return sample data but make it explicit.
            const sample = getSampleNews();
            return res.status(200).json({ ...sample, source: 'sample', error: 'SERP_API_KEY not configured' });
        }

        const newsData = await fetchAllNews();

        // If SERP returned no results across the board, expose meta so we can debug.
        const allEmpty = (!newsData.global || newsData.global.length === 0)
            && (!newsData.tech || newsData.tech.length === 0)
            && (!newsData.ai || newsData.ai.length === 0);

        if (allEmpty) {
            const sample = getSampleNews();
            return res.status(200).json({ ...sample, source: 'sample', error: 'SERP returned no results', meta: newsData.meta });
        }

        // Cache the results
        newsCache[requestedDate] = newsData;
        await fs.writeFile(newsPath, JSON.stringify(newsCache, null, 2));

        res.status(200).json({ ...newsData, source: 'serp' });
    } catch (error) {
        console.error('API ERROR: Failed to fetch news:', error);
        // Return sample data on error
        const sample = getSampleNews();
        res.status(200).json({ ...sample, source: 'sample', error: 'SERP fetch failed' });
    }
});

// Fetch news from SERP API
async function fetchAllNews() {
    const [globalNews, malaysiaNews, youtubeNews] = await Promise.all([
        fetchSerpNews('top 10 global news breaking'),
        fetchSerpNews('top 10 Malaysia top viral news latest'),
        fetchSerpYoutube('latest most viral video')
    ]);

    // propagate meta so /api/news can show *why* SERP failed (without leaking keys)
    const meta = {
        global: globalNews.meta,
        tech: malaysiaNews.meta,
        ai: youtubeNews.meta
    };

    return {
        global: processNewsResults(globalNews.results, ['BREAKING', 'WORLD', 'POLITICS'], 10),
        tech: processNewsResults(malaysiaNews.results, ['MALAYSIA', 'VIRAL', 'LOCAL'], 10),
        ai: processNewsResults(youtubeNews.results, ['VIRAL', 'YOUTUBE', 'TRENDING'], 10),
        meta
    };
}

// Fetch from SERP API
function fetchSerpNews(query) {
    return new Promise((resolve) => {
        const url = `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`;

        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    return resolve({ results: [], meta: { ok: false, status: response.statusCode, error: 'SERP returned non-JSON response' } });
                }

                // SerpAPI often returns { error: "..." } or metadata statuses when something is wrong.
                const apiError = parsed.error || parsed.search_metadata?.status;
                if (response.statusCode && response.statusCode >= 400) {
                    return resolve({
                        results: [],
                        meta: { ok: false, status: response.statusCode, error: apiError || `HTTP ${response.statusCode}` }
                    });
                }

                if (apiError && apiError !== 'Success') {
                    return resolve({ results: [], meta: { ok: false, status: response.statusCode, error: apiError } });
                }

                resolve({ results: parsed.news_results || [], meta: { ok: true, status: response.statusCode } });
            });
        }).on('error', (err) => resolve({ results: [], meta: { ok: false, status: 0, error: err.message || 'network error' } }));
    });
}

// Fetch from SERP API Youtube
function fetchSerpYoutube(query) {
    return new Promise((resolve) => {
        const url = `https://serpapi.com/search.json?engine=youtube&search_query=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`;

        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                let parsed;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    return resolve({ results: [], meta: { ok: false, status: response.statusCode, error: 'SERP returned non-JSON response' } });
                }

                const apiError = parsed.error || parsed.search_metadata?.status;
                if (response.statusCode && response.statusCode >= 400) {
                    return resolve({
                        results: [],
                        meta: { ok: false, status: response.statusCode, error: apiError || `HTTP ${response.statusCode}` }
                    });
                }

                if (apiError && apiError !== 'Success') {
                    return resolve({ results: [], meta: { ok: false, status: response.statusCode, error: apiError } });
                }

                resolve({ results: parsed.video_results || [], meta: { ok: true, status: response.statusCode } });
            });
        }).on('error', (err) => resolve({ results: [], meta: { ok: false, status: 0, error: err.message || 'network error' } }));
    });
}

// Process news results into our format
function processNewsResults(results, categories, limit = 4) {
    if (!results || results.length === 0) return [];

    return results.slice(0, limit).map((item, index) => {
        const viralScore = (9.9 - (index * 0.8) + Math.random() * 0.5).toFixed(1);
        return {
            category: categories[index % categories.length],
            headline: item.title || item.snippet || 'News Update',
            timestamp: item.date || item.published_date || new Date().toISOString(),
            viralScore: parseFloat(viralScore),
            url: item.link || '#',
            source: item.source?.name || item.channel?.name || 'Unknown',
            viewers: item.views ? `${(item.views / 1000).toFixed(1)}K` : undefined,
            thumbnail: item.thumbnail?.static || item.thumbnail || undefined
        };
    });
}

// Sample news fallback
function getSampleNews() {
    return {
        global: [
            { category: 'BREAKING', headline: 'Quantum Supremacy: Global Banking Protocol Breach Detected', timestamp: new Date().toISOString(), viralScore: 9.8, url: '#' },
            { category: 'POLITICS', headline: 'Mars Colony Charter Signed by 140 Nations', timestamp: new Date().toISOString(), viralScore: 7.2, url: '#' },
            { category: 'WORLD', headline: 'Arctic Digital Infrastructure Hub Announced', timestamp: new Date().toISOString(), viralScore: 6.5, url: '#' }
        ],
        tech: [
            { category: 'ECONOMY', headline: 'Kuala Lumpur Becomes Southeast Asia\'s Premier AI Hub', timestamp: new Date().toISOString(), viralScore: 8.5, url: '#' },
            { category: 'TECH', headline: 'Penang Semiconductor Corridor Announces Next-Gen Neural Chips', timestamp: new Date().toISOString(), viralScore: 6.9, url: '#' },
            { category: 'TECH', headline: 'OpenAI Releases GPT-5 with Multimodal Reasoning', timestamp: new Date().toISOString(), viralScore: 9.2, url: '#' }
        ],
        ai: [
            { category: 'LIVE STREAM', headline: 'NVIDIA CEO Unveils \'Project Blackwell\' - The Last Human-Designed Architecture?', timestamp: new Date().toISOString(), viralScore: 9.9, viewers: '22.4K', url: '#' },
            { category: 'SYNTHETIC MEDIA', headline: 'The Rise of AI YouTubers: Why Real Humans are Losing the Algorithm War', timestamp: new Date().toISOString(), viralScore: 8.1, url: '#' },
            { category: 'AI', headline: 'Claude 4 Passes Medical Board Exam with 99.7% Accuracy', timestamp: new Date().toISOString(), viralScore: 9.4, url: '#' }
        ]
    };
}

// Listen on the specified port
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
