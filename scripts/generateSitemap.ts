import puppeteer, { Page } from 'puppeteer';
import { URL } from 'url';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const MAX_CRAWLED_PAGES = 50000; // Limit on successfully crawled pages
const MAX_CONCURRENCY = 10;   // Number of parallel tabs
const TIMEOUT = 30000;        // Page load timeout

interface SitemapUrl {
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
}

async function main() {
    const startUrl = process.argv[2];
    const outputFile = process.argv[3] || 'sitemap.xml';

    if (!startUrl) {
        console.error('Usage: ts-node scripts/generateSitemap.ts <url> [output-file]');
        process.exit(1);
    }

    console.log(`Starting concurrent crawl of ${startUrl} with ${MAX_CONCURRENCY} workers...`);
    
    let rootHost: string;
    try {
        rootHost = new URL(startUrl).host;
    } catch (e) {
        console.error('Invalid URL provided.');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Initialize worker pages
    const pages: Page[] = [];
    for (let i = 0; i < MAX_CONCURRENCY; i++) {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Optimize: Block heavy resources
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });
        pages.push(page);
    }

    // Shared state
    const visited = new Set<string>(); // Tracks SEEN urls (to prevent cycles)
    const queue: string[] = [];
    const sitemapData: SitemapUrl[] = [];
    let activeWorkers = 0;
    let processedCount = 0; // Tracks CRAWLED pages

    // Normalize and enqueue start URL
    const normalizedStart = normalizeUrl(startUrl);
    queue.push(normalizedStart);
    visited.add(normalizedStart);

    const freePages = [...pages];

    return new Promise<void>((resolve) => {
        // Main loop trigger
        const checkQueue = () => {
            // If queue is empty and no workers are active, we are done
            if (queue.length === 0 && activeWorkers === 0) {
                resolve();
                return;
            }

            // Stop if we hit the crawled limit (soft stop: stop scheduling, let active finish)
            if (processedCount >= MAX_CRAWLED_PAGES) {
                if (queue.length > 0) {
                    console.log(`
Hit limit of ${MAX_CRAWLED_PAGES} pages. Clearing remaining queue of ${queue.length} items.`);
                    queue.length = 0;
                }
                if (activeWorkers === 0) {
                    resolve();
                }
                return;
            }

            // While there are items in queue and free pages, assign work
            while (queue.length > 0 && freePages.length > 0 && processedCount < MAX_CRAWLED_PAGES) {
                const url = queue.shift()!;
                const page = freePages.pop()!;
                
                activeWorkers++;
                // Increment processedCount eagerly to prevent over-scheduling?
                // No, count on completion to be accurate. 
                // But for strict limit we might want to check.
                // Let's count STARTING a crawl as "processing" to avoid race where we schedule 100 past limit
                
                processUrl(page, url).then(() => {
                    activeWorkers--;
                    freePages.push(page);
                    checkQueue(); // Recursively check for more work
                });
            }
        };

        const processUrl = async (page: Page, url: string) => {
            try {
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: TIMEOUT 
                });

                processedCount++; // Count finished pages
                if (processedCount % 10 === 0) {
                    process.stdout.write(`\rPages crawled: ${processedCount} | Queue: ${queue.length} | Active: ${activeWorkers}   `);
                }

                if (!response || !response.ok()) {
                    return;
                }

                // Add to sitemap (thread-safe as JS is single threaded event loop)
                sitemapData.push({
                    loc: url,
                    lastmod: new Date().toISOString().split('T')[0]
                });

                // If we are already at limit, don't bother parsing links (optimization)
                if (processedCount >= MAX_CRAWLED_PAGES) return;

                // Extract links
                const hrefs = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a'))
                        .map(a => a.href)
                        .filter(href => href);
                });

                for (const href of hrefs) {
                    try {
                        const urlObj = new URL(href);
                        
                        if (!['http:', 'https:'].includes(urlObj.protocol)) continue;
                        if (urlObj.host !== rootHost) continue;

                        const pathname = urlObj.pathname.toLowerCase();
                        if (pathname.match(/\.(pdf|jpg|jpeg|png|gif|css|js|zip|tar|gz|mp4|mp3|wav|json|xml)$/)) continue;

                        const normalized = normalizeUrl(href);
                        
                        // Atomic check-and-add
                        if (!visited.has(normalized)) {
                            visited.add(normalized);
                            queue.push(normalized);
                        }
                    } catch (e) {
                        // Ignore invalid
                    }
                }
            } catch (error) {
                 // console.error(`Error on ${url}:`, error instanceof Error ? error.message : error);
                 // Still count as processed (attempted) to avoid infinite loops on bad pages? 
                 // processedCount++; // Optional: count errors? Let's count success for now as per logic above
            }
        };

        // Kick off
        checkQueue();
    }).then(async () => {
        console.log(`\nCrawl complete. Visited ${processedCount} pages.`);
        await browser.close();
        generateXml(sitemapData, outputFile);
    });
}

function normalizeUrl(urlStr: string): string {
    try {
        const u = new URL(urlStr);
        u.hash = '';
        let s = u.toString();
        if (s.length > 1 && s.endsWith('/')) {
            s = s.slice(0, -1);
        }
        return s;
    } catch {
        return urlStr;
    }
}

function generateXml(urls: SitemapUrl[], filepath: string) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const u of urls) {
        xml += '  <url>\n';
        xml += `    <loc>${escapeXml(u.loc)}</loc>\n`;
        if (u.lastmod) xml += `    <lastmod>${u.lastmod}</lastmod>\n`;
        xml += '  </url>\n';
    }

    xml += '</urlset>';

    const outPath = path.resolve(filepath);
    fs.writeFileSync(outPath, xml);
    console.log(`Sitemap written to: ${outPath}`);
}

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"\"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

main();
