const https = require('https');

const SERP_API_KEY = 'b992be08b4f3550953414dc41fea5e7fa007b6a388237baec1284ed07dd52c39';

function fetchSerpNews(query) {
    return new Promise((resolve, reject) => {
        const url = `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}`;
        console.log(`Fetching: ${url.replace(SERP_API_KEY, 'HIDDEN')}`);

        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        console.error('SerpApi Error:', parsed.error);
                        resolve([]);
                    } else {
                        resolve(parsed.news_results || []);
                    }
                } catch (e) {
                    console.error('JSON Parse Error:', data);
                    resolve([]);
                }
            });
        }).on('error', (err) => {
            console.error('HTTP Error:', err);
            resolve([]);
        });
    });
}

(async () => {
    const results = await fetchSerpNews('top 10 global news breaking');
    console.log(`Found ${results.length} results`);
    if (results.length > 0) {
        console.log('First result:', results[0].title);
    }
})();
