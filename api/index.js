const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const app = express();

// Paths
const dbPath = path.resolve(process.cwd(), 'api', 'db.json');
const newsPath = path.resolve(process.cwd(), 'api', 'news-cache.json');
const PORT = process.env.PORT || 3000;

// In-memory cache for Vercel (since filesystem is read-only)
let inMemoryNewsCache = null;

// SERP API Configuration
const SERP_API_KEY = process.env.SERP_API_KEY || 'b992be08b4f3550953414dc41fea5e7fa007b6a388237baec1284ed07dd52c39';

app.use(express.json());

// Serve static files from the public folder
app.use(express.static(path.join(process.cwd(), 'public')));

// Helper to read news cache
async function readNewsCache() {
    if (inMemoryNewsCache) return inMemoryNewsCache;
    try {
        const data = await fs.readFile(newsPath, 'utf8');
        inMemoryNewsCache = JSON.parse(data);
        return inMemoryNewsCache;
    } catch (error) {
        console.warn('CACHE: Could not read news-cache.json, using empty cache');
        inMemoryNewsCache = {};
        return inMemoryNewsCache;
    }
}

// Helper to write news cache
async function writeNewsCache(cache) {
    inMemoryNewsCache = cache;
    try {
        // Only attempt to write if not in Vercel environment or if we want to try anyway
        await fs.writeFile(newsPath, JSON.stringify(cache, null, 2));
    } catch (error) {
        console.warn('CACHE: Could not write to news-cache.json (expected on Vercel):', error.message);
    }
}

// API endpoint to serve task data
app.get('/api/tasks', async (req, res) => {
    try {
        const data = await fs.readFile(dbPath, 'utf8');
        const jsonData = JSON.parse(data);
        res.status(200).json(jsonData.tasks || []);
    } catch (error) {
        console.error('API ERROR: Failed to read task database:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// API endpoint to serve available news dates
app.get('/api/news/dates', async (req, res) => {
    try {
        const newsCache = await readNewsCache();
        const todayStr = new Date().toISOString().split('T')[0];
        const dates = new Set(Object.keys(newsCache));
        dates.add(todayStr);
        const sortedDates = Array.from(dates).sort((a, b) => b.localeCompare(a));
        res.status(200).json(sortedDates);
    } catch (error) {
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

        const newsCache = await readNewsCache();

        if (!forceRefresh && newsCache[requestedDate]) {
            return res.status(200).json(newsCache[requestedDate]);
        }

        if (requestedDate !== todayStr && !forceRefresh) {
            return res.status(200).json({ global: [], tech: [], ai: [] });
        }

        const newsData = await fetchAllNews();
        newsCache[requestedDate] = newsData;
        await writeNewsCache(newsCache);

        res.status(200).json(newsData);
    } catch (error) {
        console.error('API ERROR: Failed to fetch news:', error);
        res.status(200).json(getSampleNews());
    }
});

// Sync endpoint
app.get('/api/news/sync', async (req, res) => {
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        const newsData = await fetchAllNews();
        const newsCache = await readNewsCache();
        newsCache[todayStr] = newsData;
        await writeNewsCache(newsCache);
        res.status(200).json({ status: 'success', date: todayStr, articles: newsData });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

async function fetchAllNews() {
    try {
        const [globalNews, malaysiaNews, youtubeNews] = await Promise.all([
            fetchSerpNews('top global stories breaking news'),
            fetchSerpNews('Malaysia latest viral news'),
            fetchSerpYoutube('latest viral tech videos')
        ]);

        return {
            global: processNewsResults(globalNews, ['BREAKING', 'WORLD', 'POLITICS'], 10),
            tech: processNewsResults(malaysiaNews, ['MALAYSIA', 'VIRAL', 'LOCAL'], 10),
            ai: processNewsResults(youtubeNews, ['VIRAL', 'YOUTUBE', 'TRENDING'], 10)
        };
    } catch (error) {
        console.error('FETCH ERROR:', error);
        return getSampleNews();
    }
}

function fetchSerpNews(query) {
    return new Promise((resolve) => {
        const url = `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.news_results || []);
                } catch (e) { resolve([]); }
            });
        }).on('error', () => resolve([]));
    });
}

function fetchSerpYoutube(query) {
    return new Promise((resolve) => {
        const url = `https://serpapi.com/search.json?engine=youtube&search_query=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed.video_results || []);
                } catch (e) { resolve([]); }
            });
        }).on('error', () => resolve([]));
    });
}

function processNewsResults(results, categories, limit = 10) {
    if (!results || !Array.isArray(results)) return [];
    return results.slice(0, limit).map((item, index) => ({
        category: categories[index % categories.length],
        headline: item.title || item.snippet || 'Intelligence Update',
        timestamp: item.date || item.published_date || new Date().toISOString(),
        viralScore: parseFloat((9.9 - (index * 0.5) - Math.random() * 0.3).toFixed(1)),
        url: item.link || '#',
        source: item.source?.name || item.channel?.name || 'Central Intel',
        viewers: item.views ? `${(item.views / 1000).toFixed(1)}K` : undefined,
        thumbnail: item.thumbnail?.static || item.thumbnail || undefined
    }));
}

function getSampleNews() {
    return {
        global: [{ category: 'BREAKING', headline: 'Satellite Data Confirms Core Stability', timestamp: new Date().toISOString(), viralScore: 9.9, url: '#' }],
        tech: [{ category: 'MALAYSIA', headline: 'KL Tech Corridor Expands Operations', timestamp: new Date().toISOString(), viralScore: 8.8, url: '#' }],
        ai: [{ category: 'VIRAL', headline: 'Neural Link Phase 4 Deployment Successful', timestamp: new Date().toISOString(), viralScore: 9.5, url: '#' }]
    };
}

// Start server
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Development server running on port ${PORT}`);
    });
}

module.exports = app;
