import chalk from "chalk";
import cliProgress from 'cli-progress'
import { averageFilter } from "./averageFilter.js";
import Bottleneck from "bottleneck";


function formatTime(minutes) {
    const days = Math.floor(minutes / 1440); // 1 day = 1440 minutes
    const hours = Math.floor((minutes % 1440) / 60); // Remaining hours
    const mins = Math.floor(minutes % 60); // Remaining minutes

    let result = [];
    if (days > 0) result.push(`${days} day${days > 1 ? 's' : ''}`);
    if (hours > 0) result.push(`${hours} hr${hours > 1 ? 's' : ''}`);
    if (mins > 0 || result.length === 0) result.push(`${mins} min${mins > 1 ? 's' : ''}`);

    return result.join(" ");
}





async function processContactTime(timeline) {
    const reversedTimeline = [...timeline].reverse();

    let referralSent = null;
    let lastContact = null;

    for (const item of reversedTimeline) {
        switch (item.timelineItemType) {
            case "NEW_REFERRAL":
                referralSent = new Date(item.itemDate);
                lastContact = null; // Reset when a new referral is found
                break;
            case "CONTACT":
            case "TEACHING":
                if (!lastContact) {
                    lastContact = new Date(item.itemDate);
                }
                break;
            default:
                continue;
        }
    }

    if (referralSent && lastContact) {
        const duration = (lastContact - referralSent) / (1000 * 60); // Convert milliseconds to minutes
        return Math.floor(duration);
    }

    return null;
}

async function contactTimeUnhinged(guid, page, bar, unprocessedContacts, person) {
    // await delay(500); // Wait .5 second between requests
    const response = await page.evaluate(async (guid) => {
        const url = `https://referralmanager.churchofjesuschrist.org/services/progress/timeline/${guid}`;
        const response = await fetch(url, {method: 'GET'} )
        return await response.json()
    }, guid)

    bar.increment()

    const time = await processContactTime(response)
    if (!unprocessedContacts[person.zoneName]) {
        unprocessedContacts[person.zoneName] = [];
    }
    unprocessedContacts[person.zoneName].push(time);
    
}

const limiter = new Bottleneck({
    maxConcurrent: 10,
})



export async function getAverage(wholeShebang, page) {
    const bar = new cliProgress.SingleBar({
        format: 'DigiStalking People |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} People || ETA: {eta_formatted}',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    });

    let parsed = await averageFilter(wholeShebang);    
    let unprocessedContacts = {};

    bar.start(parsed.length, 0);

    let tasks = parsed
        .filter(person => person.guid) // Ignore people without a GUID
        .map(person => 
            limiter.schedule(() => 
                contactTimeUnhinged(person.guid, page, bar, unprocessedContacts, person)
            )
        );
    await Promise.all(tasks)

    bar.stop();

    // Remove empty zones
    delete unprocessedContacts[null];
    delete unprocessedContacts[undefined];
    delete unprocessedContacts[""];
    delete unprocessedContacts['Dothan']

    // Compute and sort averages
    let zoneAverages = Object.entries(unprocessedContacts)
        .map(([zone, times]) => ({ zone: zone.trim(), avgTime: times.reduce((sum, t) => sum + (t || 0), 0) / times.length })) // Compute numeric average
        .sort((a, b) => a.avgTime - b.avgTime); // Sort by shortest average contact time

    // Construct message
    let message = "-->Contact Time<--\n";
    for (const { zone, avgTime } of zoneAverages) {
        message += `↳ ${zone}: ${formatTime(avgTime)}\n`;
    }

    return message;
}
