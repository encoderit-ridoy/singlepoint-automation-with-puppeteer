// Navigate to the login page
await $page.goto('https://apps.singlepointrating.com/webapps/sprapp/#/login', { waitUntil: 'networkidle2' });

// Hardcoded email and password
const username = 'agent1';
const password = 'Singapore@2025';

//Insurance type
const type = $json.type || 'auto';

// Get the license number from the incoming JSON
const licenseNo = $json.license_no || 'SA5761048';

// Ensure credentials are present
if (!username || !password) {
    throw new Error('Missing credentials. Provide { "UserName": "email", "Password": "password" }');
}

// Wait for the SinglePoint ID field and type in the username
await $page.waitForSelector('input[name="UserName"]', { timeout: 10000 });
await $page.click('input[name="UserName"]', { clickCount: 3 }).catch(() => {}); // clear the field first
await $page.type('input[name="UserName"]', username, { delay: 30 }); // type username

// Wait for the password field and type in the password
await $page.waitForSelector('input[name="Password"]', { timeout: 10000 });
await $page.click('input[name="Password"]', { clickCount: 3 }).catch(() => {}); // clear the field first
await $page.type('input[name="Password"]', password, { delay: 30 }); // type password

// Click the login button
await Promise.all([
    $page.click('button.o-btn.o-btn--large'), // login button
    $page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => null), // wait for navigation
]);

// Optionally, wait for a post-login element to ensure login success (e.g., dashboard)
await $page.waitForSelector('.sidebox', { timeout: 10000 }).catch(() => null); // replace with valid selector after login

// Wait for the sidebox to appear and find all anchor tags
await $page.waitForSelector('.sidebox .app-button-square', { timeout: 10000 });

// Get all the anchor elements inside the sidebox
const buttons = await $page.$$('.sidebox .app-button-square');

// Variable to store which button was clicked
let clickedButton = '';

if (type === 'auto') {
    await buttons[0].click();
    clickedButton = 'Auto';
    console.log('Clicked on "Auto"');
} else if (type === 'home') {
    await buttons[1].click();
    clickedButton = 'Home';
    console.log('Clicked on "Home"');
} else if (type === 'dwelling') {
    await buttons[2].click();
    clickedButton = 'Dwelling';
    console.log('Clicked on "Dwelling"');
} else if (type === 'umbrella') {
    await buttons[3].click();
    clickedButton = 'Umbrella';
    console.log('Clicked on "Umbrella"');
} else {
    throw new Error(`Unknown type: ${type}. No valid button to click.`);
}
await new Promise(resolve => setTimeout(resolve, 10000));

// Check if the license number starts with 'S'
if (licenseNo.startsWith('s') || licenseNo.startsWith('S')) {


await $page.waitForSelector('.sm-popup.is-active', { timeout: 30000 });

const clicked = await $page.evaluate(() => {
  const container = document.querySelector('.sm-popup.is-active');
  if (!container) return false;

  const btns = Array.from(container.querySelectorAll('button.o-btn'));
  const target = btns.find(b => (b.textContent || '').trim().includes('Use Rmv'));
  if (target) { target.click(); return true; }
  return false;
});

// Wait for the next page to load (adjust selector accordingly)
await $page.waitForSelector('#firstName0', { timeout: 60000 });

// Fill out the form on the next page
await $page.type('#firstName0', 'Rateau', { delay: 30 });  
await $page.type('#lastName0', 'Donals', { delay: 30 });
await $page.type('#licenseNumber0', licenseNo, { delay: 30 }); 


await $page.click('input.datepicker-input__input', { clickCount: 3 });
await $page.keyboard.type('08182000', { delay: 150 });
await $page.keyboard.press('Tab');


// Click the RMV Lookup button
await $page.click('button[type="submit"].o-btn');

// Wait a bit for the processing to start (instead of waitForTimeout)
await new Promise(r => setTimeout(r, 6000));

// Poll up to 90s for "Go to Quote" and click it (no $x, no waitForTimeout)
const maxMs = 90000;
const pollMs = 1000;
const start = Date.now();
let goClicked = false;

while (Date.now() - start < maxMs) {
  goClicked = await $page.evaluate(() => {
    // Look for anchors styled as buttons in the action section
    const anchors = Array.from(
      document.querySelectorAll("section.section a.o-btn")
    );

    // Try to find the "Go To Quote" link (exact or partial match)
    let target = anchors.find(
      (a) => (a.textContent || "").trim().toLowerCase() === "go to quote"
    );
    if (!target)
      target = anchors.find((a) =>
        /go\s*to\s*quote/i.test((a.textContent || "").trim())
      );

    // Click the target if visible
    if (target && target.offsetParent !== null) {
      target.scrollIntoView({ block: "center", inline: "center" });
      target.click();
      return true;
    }
    return false;
  });

  if (goClicked) {
    console.log('Clicked "Go To Quote" button');
    break;
  }

  await new Promise((r) => setTimeout(r, pollMs));
}

await new Promise((resolve) => setTimeout(resolve, 1000));

// Wait for the modal to appear (up to 30s)
await $page.waitForSelector('.modalbox__content.u-width-500px', { timeout: 30000 })
  .catch(() => console.log('⚠️ Modal did not appear within 30s'));

await new Promise(r => setTimeout(r, 1000)); // allow inner elements to render

// Try to click the "Go To Quote" button inside the modal
let modalClicked = await $page.evaluate(() => {
  const modal = document.querySelector('.modalbox__content.u-width-500px');
  if (!modal) return false;

  // Find all visible buttons in the modal
  const btns = Array.from(modal.querySelectorAll('button.o-btn'));
  const target = btns.find(b => {
    const txt = (b.textContent || '').trim().toLowerCase();
    return txt.includes('go to quote');
  });

  if (target && target.offsetParent !== null) {
    target.scrollIntoView({ block: 'center' });
    target.click();
    return true;
  }
  return false;
});

if (modalClicked) {
  console.log('Clicked "Go To Quote" in modal');
} else {

  // optional retry (useful if animation delayed)
  await new Promise(r => setTimeout(r, 2000));
  modalClicked = await $page.evaluate(() => {
    const modal = document.querySelector('.modalbox__content.u-width-500px');
    if (!modal) return false;
    const btns = Array.from(modal.querySelectorAll('button.o-btn'));
    const target = btns.find(b => (b.textContent || '').trim().toLowerCase().includes('go to quote'));
    if (target) { target.click(); return true; }
    return false;
  });
}

// Optionally wait for next navigation or processing to start
await new Promise(r => setTimeout(r, 10000));



// Wait for the input field to be available
await $page.waitForSelector('#driverRelationshipToInsured', { timeout: 10000 });

// Clear the field if any pre-filled value exists
await $page.click('#driverRelationshipToInsured', { clickCount: 3 });
await $page.keyboard.press('Backspace');

// Type the value "Insured"
await $page.keyboard.type('Insured', { delay: 100 });

// Simulate Tab key press to move to the next field
await $page.keyboard.press('Tab');

// Optionally, wait for a moment to ensure the tab is processed
await new Promise(r => setTimeout(r, 500));

// Click the "Vehicles" tab
await $page.click('.tabs__list .tabs__item a[href*="vehicles"]');

await new Promise(r => setTimeout(r, 1000));

// Wait for the 'vehicleVin' input field to be available
await $page.waitForSelector('#vehicleVin', { timeout: 300 });

// Focus and clear any pre-existing value
await $page.click('#vehicleVin', { clickCount: 3 });
await $page.keyboard.press('Backspace');

// Type the new value into the input field
await $page.keyboard.type('1HGCY1F32RA003892', { delay: 100 });

// Optionally, press 'Tab' to move to the next field or trigger validation
await $page.keyboard.press('Tab');

await new Promise(r => setTimeout(r, 500));

// Wait for and fill the 'vehicleLocationAddress1' input
await $page.waitForSelector('#vehicleLocationAddress1', { timeout: 10000 });
await $page.click('#vehicleLocationAddress1', { clickCount: 3 });
await $page.keyboard.press('Backspace');
await $page.keyboard.type('245 1st st', { delay: 100 });

// Wait for and fill the 'vehicleLocationCity' input
await $page.waitForSelector('#vehicleLocationCity', { timeout: 10000 });
await $page.click('#vehicleLocationCity', { clickCount: 3 });
await $page.keyboard.press('Backspace');
await $page.keyboard.type('Cambridge', { delay: 100 });

// Wait for and fill the 'vehicleLocationZip' input
await $page.waitForSelector('#vehicleLocationZip', { timeout: 10000 });

// Focus the input and clear any pre-existing value
await $page.click('#vehicleLocationZip', { clickCount: 3 });
await $page.keyboard.press('Backspace');

// Type the valid ZIP code '02142'
await $page.keyboard.type('02142', { delay: 100 });

// Ensure the value is accepted by dispatching events manually (to trigger pattern validation)
await $page.evaluate(() => {
  const input = document.querySelector('#vehicleLocationZip');
  if (input) {
    input.value = '02142'; 
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true })); 
  }
});

// Wait for and fill the 'vehicleAnnualMiles' input
await $page.waitForSelector('#vehicleAnnualMiles', { timeout: 10000 });
await $page.click('#vehicleAnnualMiles', { clickCount: 3 });
await $page.keyboard.press('Backspace');
await $page.keyboard.type('10000', { delay: 100 });
await $page.keyboard.press('Tab');

// Click the "Options" tab (using partial href match)
await $page.click('.tabs__list .tabs__item a[href*="options"]');
await new Promise(r => setTimeout(r, 500));

// 1. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
await $page.click('#priorOrRenewingCarrier', { clickCount: 3 });
await $page.keyboard.press('Backspace');
await $page.keyboard.type('No Prior Coverage', { delay: 100 });
await $page.keyboard.press('Tab');


// 2.--- Fill Prior Policy Expiration Date ---
const dateSelector = '#priorPolicyExpirationDate';
const dateValue = '12/31/2025'; //
await $page.waitForSelector(dateSelector, { timeout: 10000 });
await $page.click(dateSelector, { clickCount: 3 }).catch(()=>{});
await $page.keyboard.press('Backspace').catch(()=>{});
await $page.type(dateSelector, dateValue, { delay: 100 });
await $page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, dateSelector);


// 5. Fill the 'yearsWithCurrentAgency' input field with "0"
await $page.waitForSelector('#yearsWithCurrentAgency', { timeout: 10000 });
await $page.click('#yearsWithCurrentAgency', { clickCount: 3 });
await $page.keyboard.press('Backspace');
await $page.keyboard.type('0', { delay: 100 });
await $page.keyboard.press('Tab');

await new Promise((resolve) => setTimeout(resolve, 1000));
// Take a screenshot after the page has loaded 
const screenshotPath = 'C:/InsuranceQuote/screenshot.png'; 
await $page.screenshot({ path: screenshotPath, fullPage: true });

return [{
  json: { message: 'PDF captured successfully', licenseNo: licenseNo },
}]; 

// MAPFRE "Length of Time for Continuous Coverage" — click the icon to check
const BASE_ID   = 'BSC-AUTO-002400_MAPFRELengthofTimeforContinuousCoverage';
const SEL_ITEM  = `#${BASE_ID}`;
const SEL_INPUT = `#${BASE_ID}_checkbox`;
const SEL_ICON  = `#${BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

await $page.waitForSelector(SEL_ITEM,  { timeout: 15000 });
await $page.$eval(SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' }));

// Try clicking the styled <i> icon (preferred)
let toggledIcon = false;
try {
  await $page.waitForSelector(SEL_ICON, { timeout: 2000 });
  await $page.click(SEL_ICON, { delay: 20 });
  toggledIcon = true;
} catch (_) {}

// Fallback: click the label wrapper
if (!toggledIcon) {
  await $page.click(`${SEL_ITEM} label.o-checkable`).catch(() => {});
}

// Give the UI a beat, then check state
await new Promise(r => setTimeout(r, 150));
let isChecked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);

// Last resort: force-check and fire events so Angular updates bindings
if (!isChecked) {
  await $page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    // click once more (some UIs bind on click)
    try { el.click(); } catch (e) {}
    if (!el.checked) el.checked = true;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }, SEL_INPUT);

  await new Promise(r => setTimeout(r, 100));
  isChecked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
}

// Optional coordinate click if still not toggled (rare overlays)
if (!isChecked) {
  const handle = await $page.$(SEL_ICON) || await $page.$(`${SEL_ITEM} label.o-checkable`);
  if (handle) {
    const box = await handle.boundingBox();
    if (box) {
      await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise(r => setTimeout(r, 100));
      isChecked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    }
  }
}


// --- Select "36+ months" in the MAPFRE modal (simple & robust) ---
await $page.waitForSelector('label.o-checkable input[name="parsedItemOption"]', { timeout: 15000 });

// Try by visible text first
let picked36 = await $page.evaluate(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const re36 = /36\s*\+\s*months?/i;

  const labels = Array.from(document.querySelectorAll('label.o-checkable'));
  const target = labels.find(l => {
    const txt = norm(l.innerText || l.textContent);
    return re36.test(txt);
  });
  if (!target) return false;

  // prefer clicking the custom radio icon
  const icon = target.querySelector('i.o-btn.o-btn--radio');
  if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch(e) {} }
  else { target.scrollIntoView({ block: 'center' }); try { target.click(); } catch(e) {} }

  const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
  if (input) {
    if (!input.checked) input.checked = true;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
});

if (!picked36) {
  // Fallback: click the last radio option in the list
  const clickedLast = await $page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
    if (!items.length) return false;
    const last = items[items.length - 2] || items[items.length - 1]; // prefer the 36+ before "History < 3 years" if present
    if (!last) return false;
    const label = last.closest('label.o-checkable');
    if (!label) return false;

    const icon = label.querySelector('i.o-btn.o-btn--radio');
    if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch(e) {} }
    else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch(e) {} }

    if (!last.checked) last.checked = true;
    last.dispatchEvent(new Event('input',  { bubbles: true }));
    last.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });

  if (!clickedLast) {
    throw new Error('Could not find/select the 36+ months option.');
  }
}

// Optional: verify selection & log which one is checked
const selectedText = await $page.evaluate(() => {
  const radios = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
  const checked = radios.find(r => r.checked);
  if (!checked) return '';
  const label = checked.closest('label.o-checkable');
  const span = label && label.querySelector('span');
  return (span && span.textContent || '').trim();
});
console.log('Selected option:', selectedText);


// --- Click the "Save" button inside the MAPFRE modal ---
await $page.waitForSelector('.o-btn.u-spacing--right-2', { timeout: 10000 });

const saveClicked = await $page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button.o-btn.u-spacing--right-2'));
  const saveBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'save');

  if (saveBtn) {
    saveBtn.scrollIntoView({ block: 'center' });
    saveBtn.click();
    return true;
  }
  return false;
});

// optional: wait a bit for modal to close
await $page.waitForFunction(
  () => !document.querySelector('.modalbox__content, .box--silver, [role="dialog"]'),
  { timeout: 10000 }
).catch(() => console.log('Modal did not close within 10s (continuing)'));

await $page.click('.tabs__list .tabs__item a[href*="premiums"]');

// --- Click the "Rate" button for the MAIP (CAR) row ---
await $page.waitForSelector('table.table tbody tr', { timeout: 15000 });

const clickedRate = await $page.evaluate(() => {
  // Find all rows in the premium table
  const rows = Array.from(document.querySelectorAll('table.table tbody tr'));
  for (const row of rows) {
    const text = (row.innerText || '').trim();
    if (/MAIP\s*\(CAR\)/i.test(text)) {
      // Inside that row, find a Rate button
      const btn = row.querySelector('button.o-btn, button');
      if (btn && /rate/i.test((btn.textContent || '').trim())) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      }
    }
  }
  return false;
});

// Optional: wait for next page or processing
await new Promise(r => setTimeout(r, 60000));
// --- Click the "View plan summary" button for MAIP (CAR) ---
await $page.waitForSelector('table.table tbody tr', { timeout: 15000 });

const viewClicked = await $page.evaluate(() => {
  // find all rows in the table
  const rows = Array.from(document.querySelectorAll('table.table tbody tr'));
  for (const row of rows) {
    const text = (row.innerText || '').trim();
    // look for the row containing MAIP (CAR)
    if (/MAIP\s*\(CAR\)/i.test(text)) {
      // find the "View plan summary" button in that row
      const btn = row.querySelector('button.o-btn.o-btn--outlined.o-btn--i_search-plus');
      if (btn && /view\s*plan\s*summary/i.test((btn.textContent || '').trim())) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      }
    }
  }
  return false;
});

// Optional: wait for modal or next page to appear
await new Promise(r => setTimeout(r, 30000));

// ---- helpers ----
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const BLOB_HOOK = () => {
  (function () {
    const origCreate = URL.createObjectURL.bind(URL);

    // Per-document queue for captured PDF byte arrays (as plain number[])
    Object.defineProperty(window, '__pdfQueues__', {
      value: [],
      writable: false, configurable: false, enumerable: false
    });

    function pushPdfBytes(u8) {
      try { window.__pdfQueues__.push(Array.from(u8)); } catch (_) {}
    }

    URL.createObjectURL = function (blob) {
      try {
        if (blob && typeof blob.type === 'string' && /pdf/i.test(blob.type)) {
          const r = new FileReader();
          r.onload = () => {
            try { pushPdfBytes(new Uint8Array(r.result)); } catch (_) {}
          };
          r.readAsArrayBuffer(blob);
        }
      } catch (_) {}
      return origCreate(blob);
    };
  })();
};

// 1) Install hook on the CURRENT page for any same-tab blob document loads
if ($page.evaluateOnNewDocument) {
  await $page.evaluateOnNewDocument(BLOB_HOOK);
} else {
  // Fallback: inject immediately (will still catch many SPA flows)
  await $page.evaluate(BLOB_HOOK).catch(()=>{});
}

// 2) Prepare to hook the POPUP as soon as it's created (before it navigates)
const popupPromise = new Promise(resolve => {
  $page.once('popup', async (p) => {
    try {
      if (p.evaluateOnNewDocument) {
        await p.evaluateOnNewDocument(BLOB_HOOK);
      } else {
        // fallback if method missing
        await p.evaluate(BLOB_HOOK).catch(()=>{});
      }
    } catch (_) {}
    resolve(p);
  });
});

// 3) Open the menu and click the print option
await $page.waitForSelector('#tooltipLauncherPrint', { timeout: 10000 });
await $page.$eval('#tooltipLauncherPrint', el => { el.scrollIntoView({block:'center'}); el.click(); });
await $page.waitForSelector('.tooltip__menu', { timeout: 10000 });

const clickedProposal = await $page.evaluate(() => {
  const links = Array.from(document.querySelectorAll('.tooltip__menu a.tooltip__menu-link'));
  const t = links.find(a => /Print\s*Long\s*Proposal/i.test((a.innerText || a.textContent || '').trim()));
  if (!t) return false;
  t.scrollIntoView({ block: 'center' });
  t.click(); // opens blob: in popup or same tab
  return true;
});
if (!clickedProposal) throw new Error('Could not find "Print Long Proposal" in the dropdown.');

// 4) Wait to see if a popup appears; otherwise assume same-tab
let newTab = null;
try {
  newTab = await Promise.race([
    popupPromise,
    (async () => { await sleep(1500); return null; })()
  ]);
} catch (_) {}

// 5) Allow time for blob creation & viewer init
if (newTab) {
  await newTab.bringToFront().catch(()=>{});
  await Promise.race([
    newTab.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
    newTab.waitForSelector('body', { timeout: 15000 }).catch(()=>{}),
    sleep(2000)
  ]);
} else {
  await Promise.race([
    $page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(()=>{}),
    sleep(2000)
  ]);
}

// 6) Read captured bytes from both contexts
async function pullFrom(page) {
  try {
    const arrays = await page.evaluate(() => (Array.isArray(window.__pdfQueues__) ? window.__pdfQueues__ : []));
    if (!arrays || !arrays.length) return [];
    return arrays.map(a => Buffer.from(Uint8Array.from(a)));
  } catch (_) { return []; }
}
const mainBufs  = await pullFrom($page);
const popupBufs = newTab ? await pullFrom(newTab) : [];
const allBufs   = mainBufs.concat(popupBufs).filter(b => b && b.length);

if (!allBufs.length) {
  // Optional: last-chance network sniff with magic-byte check (covers octet-stream)
  function armPdfCatcher(page) {
    return new Promise(resolve => {
      const pdfs = [];
      const handler = async (resp) => {
        try {
          const headers = resp.headers() || {};
          const ct = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
          const cd = (headers['content-disposition'] || headers['Content-Disposition'] || '').toLowerCase();
          const buf = await (resp.buffer ? resp.buffer() : Buffer.from(await resp.arrayBuffer()));
          if (!buf || !buf.length) return;
          const looksPdf = ct.includes('application/pdf') ||
                           cd.includes('.pdf') ||
                           buf.slice(0,5).toString('ascii') === '%PDF-';
          if (looksPdf) pdfs.push({ buf });
        } catch (_) {}
      };
      page.on('response', handler);
      resolve({
        stop: () => page.off('response', handler),
        best: () => pdfs.sort((a,b)=> (b.buf.length)-(a.buf.length))[0] || null
      });
    });
  }

  const mainCatch = await armPdfCatcher($page);
  const popCatch  = newTab ? await armPdfCatcher(newTab) : null;

  // Let any late requests finish
  await sleep(2000);

  const bestNet = [popCatch && popCatch.best(), mainCatch.best()].filter(Boolean)
                   .sort((a,b)=> b.buf.length - a.buf.length)[0] || null;
  mainCatch.stop(); if (popCatch) popCatch.stop();

  if (!bestNet) {
    throw new Error('No Blob-captured PDF found and no PDF-like network response. The app may be opening print-HTML.');
  }
  allBufs.push(bestNet.buf);
}

// 7) Choose the biggest buffer and return as n8n binary (Input Binary Field = "proposal")
allBufs.sort((a,b) => b.length - a.length);
const best = allBufs[0];

return [{
  json: { message: 'PDF captured successfully', size: best.length, licenseNo: licenseNo },
  binary: {
    proposal: {
      data: best.toString('base64'),
      mimeType: 'application/pdf',
      fileName: `${licenseNo}.pdf`
    }
  }
}];

// Take a screenshot after the page has loaded 
// const screenshotPath = 'C:/ss/screenshot.png'; 
// await $page.screenshot({ path: screenshotPath, fullPage: true });

}