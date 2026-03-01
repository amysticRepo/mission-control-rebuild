/**
 * Standalone News Fetcher - Direct SerpApi Caller
 * Updates api/news-cache.json for the current date.
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');

// Configuration
const SERP_API_KEY = process.env.SERP_API_KEY || 'b992be08b4f3550953414dc41fea5e7fa007b6a388237baec1284ed07dd52c39';
const newsPath = path.resolve(__dirname, 'news-cache.json');

// Fetch from SERP API
function fetchSerp(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        console.error(`SerpApi Error: ${parsed.error}`);
                        resolve(null);
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    console.error('JSON Parse Error');
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.error('HTTP Error:', err.message);
            resolve(null);
        });
    });
}

// Process results
function processNewsResults(results, categories, limit = 10) {
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

async function run() {
    console.log('--- Starting Manual News Sync ---');
    const todayStr = new Date().toISOString().split('T')[0];

    try {
        console.log(`Date: ${todayStr}`);
        console.log('Fetching Google News (Global)...');
        const globalResults = await fetchSerp(`https://serpapi.com/search.json?engine=google_news&q=top+10+global+news+breaking&api_key=${SERP_API_KEY}`);

        console.log('Fetching Google News (Malaysia)...');
        const malaysiaResults = await fetchSerp(`https://serpapi.com/search.json?engine=google_news&q=top+10+Malaysia+top+viral+news+latest&api_key=${SERP_API_KEY}`);

        console.log('Fetching YouTube (Viral)...');
        const youtubeResults = await fetchSerp(`https://serpapi.com/search.json?engine=youtube&search_query=latest+most+viral+video&api_key=${SERP_API_KEY}`);

        const newsData = {
            global: processNewsResults(globalResults?.news_results, ['BREAKING', 'WORLD', 'POLITICS']),
            tech: processNewsResults(malaysiaResults?.news_results, ['MALAYSIA', 'VIRAL', 'LOCAL']),
            ai: processNewsResults(youtubeResults?.video_results, ['VIRAL', 'YOUTUBE', 'TRENDING'])
        };

        // Load existing cache
        let newsCache = {};
        try {
            const cacheData = await fs.readFile(newsPath, 'utf8');
            newsCache = JSON.parse(cacheData);
        } catch (e) {
            console.log('Cache file not found or invalid, creating new one.');
        }

        // Update cache
        newsCache[todayStr] = newsData;
        await fs.writeFile(newsPath, JSON.stringify(newsCache, null, 2));

        console.log('--- News Sync Completed Successfully ---');
        console.log(`Global: ${newsData.global.length}, Tech/Local: ${newsData.tech.length}, AI/Viral: ${newsData.ai.length}`);
    } catch (error) {
        console.error('FATAL ERROR:', error);
        process.exit(1);
    }
}

run();
