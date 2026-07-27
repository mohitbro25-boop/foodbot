const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'food_config.json');

async function submit() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error('Error: food_config.json not found');
        process.exit(1);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    const isCloud = !!process.env.PUPPETEER_EXECUTABLE_PATH;
    console.log(`Launching Browser (${isCloud ? 'Cloud/Headless' : 'Local/Brave'})...`);
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        headless: isCloud ? 'new' : false, // Run headfully locally to sign in, headlessly in Docker cloud
        userDataDir: path.join(__dirname, 'google_session'),
        ignoreDefaultArgs: ['--enable-automation'], // Hide the automation bar to bypass Google security blocker
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled' // Hide navigator.webdriver
        ]
    });

    try {
        const page = await browser.newPage();
        
        // Evade webdriver detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });
        });
        
        // Set viewport size
        await page.setViewport({ width: 1280, height: 800 });
        
        console.log('Navigating to Google Form...');
        await page.goto('https://docs.google.com/forms/d/e/1FAIpQLScOts6_-O5PvbxVO17vEcUmKyTVFD6vzSdV5naX0LH6uiko1g/viewform', {
            waitUntil: 'networkidle2', // Wait until network settles to let login redirect happen
            timeout: 60000
        });

        // Extra wait for any dynamic redirects to settle
        await new Promise(r => setTimeout(r, 3000));

        // Check if redirected to Google Accounts login page
        if (page.url().includes('accounts.google.com')) {
            console.log('--- ACTION REQUIRED: PLEASE SIGN IN TO YOUR GOOGLE ACCOUNT IN THE OPENED BROWSER WINDOW ---');
            // Wait for user to log in and get redirected back to the form page (timeout: 5 mins)
            await page.waitForFunction(
                () => window.location.href.includes('docs.google.com/forms'),
                { timeout: 300000, polling: 1000 }
            );
            console.log('Google login successful!');
            // Wait another 2 seconds for form loading after login redirect
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log('Waiting for form container...');
        await page.waitForSelector('form', { timeout: 30000 });

        // 1. Fill Student Name
        console.log(`Filling Student Name: ${config.student_name}...`);
        // Select the text input that is visible
        const nameInput = await page.waitForSelector('form input[type="text"]', { visible: true, timeout: 15000 });
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(config.student_name, { delay: 50 });

        // Wait a bit
        await new Promise(r => setTimeout(r, 1000));

        // Locate listboxes (dropdowns)
        console.log('Locating dropdown elements...');
        const dropdowns = await page.$$('form div[role="listbox"]');
        if (dropdowns.length >= 2) {
            // 2. Select Hostel Name
            console.log(`Selecting Hostel: ${config.hostel_name}...`);
            await dropdowns[0].click();
            await new Promise(r => setTimeout(r, 1000));
            
            // Find and click the matching hostel option
            const clickedHostel = await page.evaluate((hostelName) => {
                const options = Array.from(document.querySelectorAll('div[role="option"]'));
                const target = options.find(el => el.textContent.trim().toLowerCase() === hostelName.trim().toLowerCase());
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, config.hostel_name);
            
            if (!clickedHostel) {
                console.log(`Warning: Hostel option "${config.hostel_name}" not found. Trying prefix match...`);
                await page.evaluate((hostelName) => {
                    const options = Array.from(document.querySelectorAll('div[role="option"]'));
                    const target = options.find(el => el.textContent.toLowerCase().includes(hostelName.toLowerCase().split(' ')[0]));
                    if (target) target.click();
                }, config.hostel_name);
            }
            
            await new Promise(r => setTimeout(r, 1000));

            // 3. Select Campus Name
            console.log(`Selecting Campus: ${config.campus_name}...`);
            await dropdowns[1].click();
            await new Promise(r => setTimeout(r, 1000));
            
            const clickedCampus = await page.evaluate((campusName) => {
                const options = Array.from(document.querySelectorAll('div[role="option"]'));
                const target = options.find(el => el.textContent.trim().toLowerCase() === campusName.trim().toLowerCase());
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, config.campus_name);
            
            if (!clickedCampus) {
                await page.evaluate((campusName) => {
                    const options = Array.from(document.querySelectorAll('div[role="option"]'));
                    const target = options.find(el => el.textContent.toLowerCase().includes(campusName.toLowerCase()));
                    if (target) target.click();
                }, config.campus_name);
            }

            await new Promise(r => setTimeout(r, 1000));
        } else {
            console.error('Error: Could not locate listboxes for Hostel/Campus.');
        }

        // 4. Select Jain Food Choice
        console.log(`Selecting Jain Food: ${config.jain_food}...`);
        await page.evaluate((jainChoice) => {
            const options = Array.from(document.querySelectorAll('div[role="radio"], div[role="checkbox"], label'));
            const target = options.find(el => el.textContent.trim().toLowerCase() === jainChoice.trim().toLowerCase());
            if (target) {
                target.click();
            } else {
                // Fallback: look for aria-label or basic radio buttons
                const inputs = Array.from(document.querySelectorAll('div[role="radio"]'));
                const fbTarget = inputs.find(el => el.getAttribute('aria-label') && el.getAttribute('aria-label').toLowerCase().includes(jainChoice.toLowerCase()));
                if (fbTarget) fbTarget.click();
            }
        }, config.jain_food);

        await new Promise(r => setTimeout(r, 1000));

        // 5. Submit Form
        console.log('Submitting form...');
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
            const submitBtn = buttons.find(el => el.textContent.trim().toLowerCase().includes('submit'));
            if (submitBtn) {
                submitBtn.click();
            } else {
                const form = document.querySelector('form');
                if (form) form.submit();
            }
        });

        // Wait for confirmation message or page load
        console.log('Waiting for confirmation...');
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
        
        const bodyText = await page.evaluate(() => document.body.textContent);
        if (bodyText.includes('Your response has been recorded') || bodyText.includes('submitted')) {
            console.log('Success: Food order submitted successfully!');
        } else {
            console.log('Warning: Form submitted, but confirmation text not detected.');
        }

    } catch (error) {
        console.error(`Submission error: ${error.message}`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

submit().catch(console.error);
