// Navigate to the login page
await $page.goto('https://apps.singlepointrating.com/webapps/sprapp/#/login', { waitUntil: 'networkidle2' });

// Hardcoded email and password
const username = 'agent1';
const password = 'Singapore@2025';

//Insurance type
const type = $json.type || 'auto';

// Get the license number from the incoming JSON
const licenseNo = '{{ $json.body.zoho_r_data.license_number }}' || 'SA5761048';

// Ensure credentials are present
if (!username || !password) {
  throw new Error('Missing credentials. Provide { "UserName": "email", "Password": "password" }');
}

// Wait for the SinglePoint ID field and type in the username
await $page.waitForSelector('input[name="UserName"]', { timeout: 10000 });
await $page.click('input[name="UserName"]', { clickCount: 3 }).catch(() => { }); // clear the field first
await $page.type('input[name="UserName"]', username, { delay: 30 }); // type username

// Wait for the password field and type in the password
await $page.waitForSelector('input[name="Password"]', { timeout: 10000 });
await $page.click('input[name="Password"]', { clickCount: 3 }).catch(() => { }); // clear the field first
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
  console.log('Clicked on "Home "');
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

const dateStr = '{{ $json.body.step_4_driver_date_of_birth_1 }}';
// Convert to MMDDYYYY
  function formatDateToMMDDYYYY(dateStr) {
    const date = new Date(dateStr); // JS can parse '11-May-1995'
    const month = String(date.getMonth() + 1).padStart(2, '0'); // months are 0-based
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}${day}${year}`;
  }

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
  await $page.waitForSelector('#firstName0', { timeout: 30000 });

  const firstName = '{{ $json.body.step_4_driver_first_name_1 }}';
  const lastName = '{{ $json.body.step_4_driver_last_name_1 }}';

  // Fill out the form on the next page
  await $page.type('#firstName0', firstName, { delay: 30 });
  await $page.type('#lastName0', lastName, { delay: 30 });
  await $page.type('#licenseNumber0', '{{ $json.body.step_4_driver_license_number_1 }}', { delay: 30 });

  const dobFormatted = formatDateToMMDDYYYY(dateStr);

  await $page.click('input.datepicker-input__input', { clickCount: 3 });
  await $page.keyboard.type(dobFormatted, { delay: 150 });
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
    .catch(() => console.log('Modal did not appear within 30s'));

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

  const firstLicenseNo = '{{ $json.body.step_3_data.date_of_first_licensed }}';

  if (firstLicenseNo) {
    const firstLicenseFormatted = formatDateToMMDDYYYY(firstLicenseNo);
    await $page.type('#driverFirstLicensed', firstLicenseFormatted, { delay: 100 });
    await $page.keyboard.press('Tab');
  }

  // Optionally, wait for a moment to ensure the tab is processed
  await new Promise(r => setTimeout(r, 500));

  // Click the "Vehicles" tab
  await $page.click('.tabs__list .tabs__item a[href*="vehicles"]');

  await new Promise(r => setTimeout(r, 1000));

  const vehicleVin = '{{ $json.body.step_5_vehicle_identification_number_1 }}';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Only execute Puppeteer actions if VIN exists and is not empty
  if (vehicleVin && vehicleVin.trim() !== '') {
    // Wait for the 'vehicleVin' input field to be available
    await $page.waitForSelector('#vehicleVin', { timeout: 300 });

    // Focus and clear any pre-existing value
    await $page.click('#vehicleVin', { clickCount: 3 });
    await $page.keyboard.press('Backspace');

    // Type the new value into the input field
    await $page.keyboard.type(vehicleVin, { delay: 100 });
    await $page.keyboard.press('Tab');
    await new Promise(r => setTimeout(r, 500));
  }
  else {


    async function openSelectLike($page, inputSel) {
      await $page.waitForSelector(inputSel, { timeout: 30000 });
      await $page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), inputSel);

      await $page.click(inputSel).catch(() => { });
      await $page.focus(inputSel).catch(() => { });

      // remove readonly if present
      await $page.evaluate((s) => { const el = document.querySelector(s); if (el) el.removeAttribute('readonly'); }, inputSel);

      // try common open gestures
      await $page.keyboard.press('ArrowDown').catch(() => { });
      await $page.keyboard.press('Alt+ArrowDown').catch(() => { });
      await $page.keyboard.press('Space').catch(() => { });

      // try clicking a caret/toggle near the input
      await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return;
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper') || el.parentElement;
        const btn = root && root.querySelector('button,[role="button"],.icon-chevron,.icon-caret,.autocomplete__btn,.sm-input-select__btn');
        if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }, inputSel);
    }

    /**
     * Try to pick an option rendered NEAR the input (same wrapper), then ANYWHERE.
     * No 'visible:true' requirements; we filter by visibility manually.
     */
    async function pickByTextRobust($page, inputSel, text) {
      const nearSelectors = [
        '.sm-input-select__menu .sm-input-select__option',
        '.autocomplete__menu .autocomplete__item',
        'ul li', 'li', '[role="option"]', '[data-option]', '.option', '.item'
      ];
      const globalSelectors = [
        // global overlays & libs
        '.cdk-overlay-container [role="option"]',
        '.cdk-overlay-pane [role="option"]',
        '.mat-select-panel .mat-option',
        '.ng-dropdown-panel .ng-option',
        '.ng-select .ng-option',
        // your original guesses
        '.sm-input-select__menu .sm-input-select__option',
        '.autocomplete__menu .autocomplete__item',
        // very generic dropdowns
        '.dropdown-menu .dropdown-item',
        '[role="listbox"] [role="option"]',
        '[role="option"]',
      ];

      // 1) Search relative to the input
      const clickedNear = await $page.evaluate((s, target, sels) => {
        const norm = (x) => (x || '').trim().toLowerCase();
        const host = document.querySelector(s);
        if (!host) return false;
        const root = host.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form, div') || host.parentElement || document.body;

        for (const sel of sels) {
          const nodes = Array.from(root.querySelectorAll(sel));
          const visible = nodes.filter(n => !!(n.offsetParent || n.getClientRects().length));
          if (!visible.length) continue;

          const exact = visible.find(n => norm(n.textContent) === norm(target));
          if (exact) { exact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); exact.click(); return true; }

          const part = visible.find(n => norm(n.textContent).includes(norm(target)));
          if (part) { part.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); part.click(); return true; }
        }
        return false;
      }, inputSel, text, nearSelectors);

      if (clickedNear) return true;

      // 2) Global search (overlays, portals). No visible:true; we filter manually.
      const clickedGlobal = await $page.evaluate((target, sels) => {
        const norm = (x) => (x || '').trim().toLowerCase();

        const getVisibleNodes = (selector) => {
          const all = Array.from(document.querySelectorAll(selector));
          return all.filter(n => !!(n.offsetParent || n.getClientRects().length));
        };

        for (const sel of sels) {
          const visible = getVisibleNodes(sel);
          if (!visible.length) continue;

          const exact = visible.find(n => norm(n.textContent) === norm(target));
          if (exact) { exact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); exact.click(); return true; }

          const part = visible.find(n => norm(n.textContent).includes(norm(target)));
          if (part) { part.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); part.click(); return true; }
        }
        return false;
      }, text, globalSelectors);

      if (clickedGlobal) return true;

      // 3) Keyboard fallback (first option)
      try {
        await $page.keyboard.press('ArrowDown');
        await $page.keyboard.press('Enter');
        return true;
      } catch { /* ignore */ }

      return false;
    }

    // Convenience: fill a select-like field
    async function fillSelectLike($page, inputSel, value) {
      await openSelectLike($page, inputSel);

      // Clear + type value (some UIs require >=2 chars before options appear)
      await $page.click(inputSel, { clickCount: 3 }).catch(() => { });
      for (let i = 0; i < 8; i++) { try { await $page.keyboard.press('Backspace'); } catch { } }
      await $page.type(inputSel, value, { delay: 70 });

      // small grace period for API-loaded lists
      await sleep(400);

      const ok = await pickByTextRobust($page, inputSel, value);
      // commit
      await $page.keyboard.press('Tab').catch(() => { });
      return ok;
    }

    // ----------------- USAGE -----------------

    // Always do Year -> Make -> Model in order
    // await fillSelectLike($page, '#vehicleYear', '{{ $json.body.step_5_vehicle_year_1 }}');
    // await fillSelectLike($page, '#vehicleMake', '{{ $json.body.step_5_vehicle_make_1 }}');
    // const picked = await fillSelectLike($page, '#vehicleModel', '{{ $json.body.step_5_vehicle_model_1 }}');
    await fillSelectLike($page, '#vehicleYear', '2016');
    await fillSelectLike($page, '#vehicleMake', 'Subaru');
    const picked = await fillSelectLike($page, '#vehicleModel', 'OUTBACK');

    if (!picked) {
      // Debug snapshot around the model field to see what’s actually rendered
      const debugHTML = await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'input not found';
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form') || document.body;
        return root.outerHTML.slice(0, 15000); // limit size
      }, '#vehicleModel');
    }

    await sleep(700);

    // ---- Trim selection with a retry ----
    async function fillTrim(value) {
      // first attempt
      let ok = await fillSelectLike($page, '#vehicleTrim', value);
      if (ok) return true;

      // small pause + second attempt (some APIs are slow)
      await sleep(800);
      ok = await fillSelectLike($page, '#vehicleTrim', value);
      return ok;
    }

    const trimValue = '{{ $json.body.step_5_reg_type_1 }}'; // <-- set your target trim label here
    const trimPicked = await fillTrim(trimValue);

    // Optional debug if still not picked
    if (!trimPicked) {
      const debugHTML = await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'trim input not found';
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form') || document.body;
        return root.outerHTML.slice(0, 20000);
      }, '#vehicleTrim');
    }



  }



  // Wait for and fill the 'vehicleLocationAddress1' input
  await $page.waitForSelector('#vehicleLocationAddress1', { timeout: 10000 });
  await $page.click('#vehicleLocationAddress1', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('{{ $json.body.step_1_data.address1 }}', { delay: 100 });

  // Wait for and fill the 'vehicleLocationCity' input
  await $page.waitForSelector('#vehicleLocationCity', { timeout: 10000 });
  await $page.click('#vehicleLocationCity', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('{{ $json.body.step_1_data.city }}', { delay: 100 });

  // Wait for and fill the 'vehicleLocationZip' input
  await $page.waitForSelector('#vehicleLocationZip', { timeout: 10000 });

  // Focus the input and clear any pre-existing value
  await $page.click('#vehicleLocationZip', { clickCount: 3 });
  await $page.keyboard.press('Backspace');

  // Type the valid ZIP code '02142'
  await $page.keyboard.type('{{ $json.body.step_1_data.zip }}', { delay: 100 });

  // Ensure the value is accepted by dispatching events manually (to trigger pattern validation)
  await $page.evaluate(() => {
    const input = document.querySelector('#vehicleLocationZip');
    if (input) {
      input.value = '{{ $json.body.step_1_data.zip }}';
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
  await new Promise((resolve) => setTimeout(resolve, 1000));



  // Click the "Options" tab (using partial href match)
  await $page.click('.tabs__list .tabs__item a[href*="options"]');


  // 1. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#priorOrRenewingCarrier', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('Other', { delay: 100 });
  await $page.keyboard.press('Tab');

  //Get the raw date string from your JSON
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const optionDate = `${String(nextYear.getMonth() + 1).padStart(2, '0')}/${String(nextYear.getDate()).padStart(2, '0')}/${nextYear.getFullYear()}`; // e.g., "11-May-1995
  const optionDobFormatted = formatDateToMMDDYYYY(optionDate);

  //Only continue if we have a valid formatted date
  if (optionDobFormatted) {
    const dobSelector = 'input.datepicker-input__input';

    // Wait for the date input to appear
    await $page.waitForSelector(dobSelector, { visible: true, timeout: 10000 });

    // Clear old value (many datepickers use masks)
    await $page.click(dobSelector, { clickCount: 3 }).catch(() => { });
    for (let i = 0; i < 12; i++) { try { await $page.keyboard.press('Backspace'); } catch { } }

    // Type the date slowly so mask/formatting can process each digit
    await $page.keyboard.type(optionDobFormatted, { delay: 120 });

    // Trigger validation by tabbing out
    await $page.keyboard.press('Tab');
  } else {
    console.log('No date_of_birth found in JSON — skipping DOB input.');
  }

  //3. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });

  const YEARS_ID = '#yearsWithThisCarrier';

  // 1) Wait until it exists and is visible
  await $page.waitForSelector(YEARS_ID, { timeout: 15000 });
  await $page.$eval(YEARS_ID, el => el.scrollIntoView({ block: 'center' }));

  // 2) Try real typing first (many inputs require key events)
  await $page.focus(YEARS_ID);
  await $page.keyboard.down('Control').catch(() => { });
  await $page.keyboard.press('KeyA').catch(() => { });  // Ctrl+A
  await $page.keyboard.up('Control').catch(() => { });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('6', { delay: 80 });
  await $page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 300));

  // Check if value stuck
  let yearsVal = await $page.$eval(YEARS_ID, el => el.value || el.getAttribute('value') || '');
  if (yearsVal !== '6') {
    // 3) Open the autocomplete dropdown and click the option "6"
    const opened = await $page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const root = input.closest('.autocomplete') || input.parentElement;
      const toggle = root && root.querySelector('.autocomplete__btn-toggle');
      if (toggle) { toggle.click(); return true; }
      // Some builds open on input click
      input.click();
      return true;
    }, YEARS_ID);

    if (opened) {
      // wait for listbox to render (cover common variants)
      await $page.waitForSelector('.autocomplete__list, [role="listbox"], .cdk-overlay-container', { timeout: 5000 }).catch(() => { });

      // click an option that is exactly "6" or starts with "6"
      const picked = await $page.evaluate(() => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim();
        const candidates = [
          ...document.querySelectorAll('.autocomplete__list *'),
          ...document.querySelectorAll('[role="listbox"] *'),
          ...document.querySelectorAll('.cdk-overlay-container [role="option"], .cdk-overlay-container *')
        ];
        const target = candidates.find(el => /^6\b/.test(norm(el.textContent)));
        if (target) { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); target.click(); return true; }
        return false;
      });

      await new Promise(r => setTimeout(r, 250));
      yearsVal = await $page.$eval(YEARS_ID, el => el.value || el.getAttribute('value') || '');
      if (!picked || yearsVal !== '6') {
        // 4) Fallback: set hidden backing input + fire events
        await $page.evaluate((sel) => {
          const input = document.querySelector(sel);
          if (!input) return;
          const hidden = document.querySelector(`${sel}_value`) || input; // many components use *_value
          hidden.value = '6';
          hidden.dispatchEvent(new Event('input', { bubbles: true }));
          hidden.dispatchEvent(new Event('change', { bubbles: true }));
          input.value = '6';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, YEARS_ID);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  // Final blur to seal it
  await $page.keyboard.press('Tab').catch(() => { });
  await new Promise(r => setTimeout(r, 150));




  // 2. Fill the 'yearsWithCurrentAgency' input field with "0"
  await $page.waitForSelector('#yearsWithCurrentAgency', { timeout: 10000 });
  await $page.click('#yearsWithCurrentAgency', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('6', { delay: 100 });
  await $page.keyboard.press('Tab');

  //3. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#lapsedDaysLast12Months', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('0', { delay: 100 });
  await $page.keyboard.press('Tab');

  //4. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#priorBodilyInjurylimits', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('100/300', { delay: 100 });
  await $page.keyboard.press('Tab');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // MAPFRE "Length of Time for Continuous Coverage" — click the icon to check
  const BASE_ID = 'BSC-AUTO-002400_MAPFRELengthofTimeforContinuousCoverage';
  const SEL_ITEM = `#${BASE_ID}`;
  const SEL_INPUT = `#${BASE_ID}_checkbox`;
  const SEL_ICON = `#${BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  // Scroll into view and check if the checkbox is already checked
  await $page.$eval(SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => { });

  // Check if the checkbox is already checked
  let checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);

  if (checked) {
    console.log('Checkbox is already checked, skipping...');
  } else {
    // If not checked, try clicking the icon, label, or force-check
    try {
      await $page.waitForSelector(SEL_ICON, { timeout: 2000 });
      await $page.click(SEL_ICON, { delay: 20 });
      await sleep(150);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    } catch (_) { }

    if (!checked) {
      await $page.click(`${SEL_ITEM} label.o-checkable`).catch(() => { });
      await sleep(150);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    }

    if (!checked) {
      await $page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        try { el.click(); } catch (e) { }
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, SEL_INPUT);
      await sleep(120);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    }

    if (!checked) {
      // coordinate click as last resort
      const h = await $page.$(SEL_ICON) || await $page.$(`${SEL_ITEM} label.o-checkable`);
      if (h) {
        const box = await h.boundingBox();
        if (box) {
          await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await sleep(150);
          checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
        }
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
    if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
    else { target.scrollIntoView({ block: 'center' }); try { target.click(); } catch (e) { } }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!last.checked) last.checked = true;
      last.dispatchEvent(new Event('input', { bubbles: true }));
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



  // --- Travelers "Continuous Insurance" — click the checkbox to open modal ---
  const TRAVELERS_BASE_ID = 'BSC-AUTO-002195_TravelersContinuousInsurance';
  const TRAVELERS_SEL_ITEM = `#${TRAVELERS_BASE_ID}`;
  const TRAVELERS_SEL_INPUT = `#${TRAVELERS_BASE_ID}_checkbox`;
  const TRAVELERS_SEL_ICON = `#${TRAVELERS_BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  await $page.waitForSelector(TRAVELERS_SEL_ITEM, { timeout: 15000 });
  await $page.$eval(TRAVELERS_SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' }));

  // Try clicking the styled <i> icon (preferred)
  let travelersToggledIcon = false;
  try {
    await $page.waitForSelector(TRAVELERS_SEL_ICON, { timeout: 2000 });
    await $page.click(TRAVELERS_SEL_ICON, { delay: 20 });
    travelersToggledIcon = true;
  } catch (_) { }

  // Fallback: click the label wrapper
  if (!travelersToggledIcon) {
    await $page.click(`${TRAVELERS_SEL_ITEM} label.o-checkable`).catch(() => { });
  }

  // Give UI time to react
  await new Promise(r => setTimeout(r, 150));

  // Check state
  let travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);

  // Last resort: force-check and fire events so Angular updates bindings
  if (!travelersChecked) {
    await $page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      try { el.click(); } catch (e) { }
      if (!el.checked) el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, TRAVELERS_SEL_INPUT);

    await new Promise(r => setTimeout(r, 100));
    travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);
  }

  // Optional coordinate click (rare overlays)
  if (!travelersChecked) {
    const handle = await $page.$(TRAVELERS_SEL_ICON) || await $page.$(`${TRAVELERS_SEL_ITEM} label.o-checkable`);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 100));
        travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);
      }
    }
  }

  // --- Select the radio option inside the Travelers modal ---
  await $page.waitForSelector('label.o-checkable input[name="parsedItemOption"]', { timeout: 15000 });

  // Try by visible text ("Less than 3 years")
  let travelersPickedOption = await $page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const reLess3 = /less\s+than\s+3\s+years?/i;

    const labels = Array.from(document.querySelectorAll('label.o-checkable'));
    const target = labels.find(l => {
      const txt = norm(l.innerText || l.textContent);
      return reLess3.test(txt);
    });
    if (!target) return false;

    const icon = target.querySelector('i.o-btn.o-btn--radio');
    if (icon) {
      icon.scrollIntoView({ block: 'center' });
      try { icon.click(); } catch (e) { }
    } else {
      target.scrollIntoView({ block: 'center' });
      try { target.click(); } catch (e) { }
    }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  });

  if (!travelersPickedOption) {
    // Fallback: click the first radio if text match not found
    const travelersClickedFirst = await $page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
      if (!items.length) return false;
      const first = items[0];
      const label = first.closest('label.o-checkable');
      if (!label) return false;

      const icon = label.querySelector('i.o-btn.o-btn--radio');
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!first.checked) first.checked = true;
      first.dispatchEvent(new Event('input', { bubbles: true }));
      first.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (!travelersClickedFirst) {
      throw new Error('Could not find/select the >=6 months & <1 yr option.');
    }
  }

  // Optional: verify selection & log which one is checked
  const travelersSelectedText = await $page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
    const checked = radios.find(r => r.checked);
    if (!checked) return '';
    const label = checked.closest('label.o-checkable');
    const span = label && label.querySelector('span');
    return (span && span.textContent || '').trim();
  });
  console.log('Travelers selected option:', travelersSelectedText);

  // --- Click the "Save" button inside the Travelers modal ---
  await $page.waitForSelector('.o-btn.u-spacing--right-2', { timeout: 10000 });

  const travelersSaveClicked = await $page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.o-btn.u-spacing--right-2'));
    const saveBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'save');
    if (saveBtn) {
      saveBtn.scrollIntoView({ block: 'center' });
      saveBtn.click();
      return true;
    }
    return false;
  });

  // optional: wait for modal close
  await $page.waitForFunction(
    () => !document.querySelector('.modalbox__content, .box--silver, [role="dialog"]'),
    { timeout: 10000 }
  ).catch(() => console.log('Travelers modal did not close within 10s (continuing)'));


  // --- Travelers "Primary Residence Type" — click the checkbox to open modal ---
  const TRAVELERS_RES_BASE_ID = 'BSC-AUTO-002152_TravelersPrimaryResidenceType';
  const TRAVELERS_RES_SEL_ITEM = `#${TRAVELERS_RES_BASE_ID}`;
  const TRAVELERS_RES_SEL_INPUT = `#${TRAVELERS_RES_BASE_ID}_checkbox`;
  const TRAVELERS_RES_SEL_ICON = `#${TRAVELERS_RES_BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  await $page.waitForSelector(TRAVELERS_RES_SEL_ITEM, { timeout: 15000 });
  await $page.$eval(TRAVELERS_RES_SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' }));

  // Try clicking the styled <i> icon (preferred)
  let travelersResToggledIcon = false;
  try {
    await $page.waitForSelector(TRAVELERS_RES_SEL_ICON, { timeout: 2000 });
    await $page.click(TRAVELERS_RES_SEL_ICON, { delay: 20 });
    travelersResToggledIcon = true;
  } catch (_) { }

  // Fallback: click the label wrapper
  if (!travelersResToggledIcon) {
    await $page.click(`${TRAVELERS_RES_SEL_ITEM} label.o-checkable`).catch(() => { });
  }

  // Wait briefly for UI reaction
  await new Promise(r => setTimeout(r, 150));

  // Check state
  let travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);

  // Last resort: force-check and dispatch events
  if (!travelersResChecked) {
    await $page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      try { el.click(); } catch (e) { }
      if (!el.checked) el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, TRAVELERS_RES_SEL_INPUT);

    await new Promise(r => setTimeout(r, 100));
    travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);
  }

  // Optional coordinate click fallback
  if (!travelersResChecked) {
    const handle = await $page.$(TRAVELERS_RES_SEL_ICON) || await $page.$(`${TRAVELERS_RES_SEL_ITEM} label.o-checkable`);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 100));
        travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);
      }
    }
  }

  // --- Select the radio option inside the Travelers Residence modal ---
  await $page.waitForSelector('label.o-checkable input[name="parsedItemOption"]', { timeout: 15000 });

  // Try by visible text ("Other")
  let travelersResPickedOption = await $page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const reOther = /^other$/i;

    const labels = Array.from(document.querySelectorAll('label.o-checkable'));
    const target = labels.find(l => {
      const txt = norm(l.innerText || l.textContent);
      return reOther.test(txt);
    });
    if (!target) return false;

    const icon = target.querySelector('i.o-btn.o-btn--radio');
    if (icon) {
      icon.scrollIntoView({ block: 'center' });
      try { icon.click(); } catch (e) { }
    } else {
      target.scrollIntoView({ block: 'center' });
      try { target.click(); } catch (e) { }
    }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  });

  if (!travelersResPickedOption) {
    // Fallback: click the first radio option
    const travelersResClickedFirst = await $page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
      if (!items.length) return false;
      const first = items[0];
      const label = first.closest('label.o-checkable');
      if (!label) return false;

      const icon = label.querySelector('i.o-btn.o-btn--radio');
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!first.checked) first.checked = true;
      first.dispatchEvent(new Event('input', { bubbles: true }));
      first.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (!travelersResClickedFirst) {
      throw new Error('Could not find/select the "Other" option.');
    }
  }

  // Optional: verify selection
  const travelersResSelectedText = await $page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
    const checked = radios.find(r => r.checked);
    if (!checked) return '';
    const label = checked.closest('label.o-checkable');
    const span = label && label.querySelector('span');
    return (span && span.textContent || '').trim();
  });

  // --- Click the "Save" button inside the Travelers Residence modal ---
  await $page.waitForSelector('.o-btn.u-spacing--right-2', { timeout: 10000 });

  const travelersResSaveClicked = await $page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.o-btn.u-spacing--right-2'));
    const saveBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'save');
    if (saveBtn) {
      saveBtn.scrollIntoView({ block: 'center' });
      saveBtn.click();
      return true;
    }
    return false;
  });

  // optional: wait for modal to close
  await $page.waitForFunction(
    () => !document.querySelector('.modalbox__content, .box--silver, [role="dialog"]'),
    { timeout: 10000 }
  ).catch(() => console.log('Travelers Residence modal did not close within 10s (continuing)'));




  await $page.click('.tabs__list .tabs__item a[href*="premiums"]');

  // --- Click the "Rate" button for the MAIP (CAR) row ---
  await $page.waitForSelector('table.table tbody tr', { timeout: 15000 });


  await $page.waitForSelector('button.app-button.app-button--save-quote', { visible: true, timeout: 10000 });
  await $page.$eval('button.app-button.app-button--save-quote', el => el.scrollIntoView({ block: 'center' }));
  await $page.click('button.app-button.app-button--save-quote', { delay: 50 });
  await new Promise(r => setTimeout(r, 2000));



  /// --- Ensure DOM is ready and button visible ---
  await $page.waitForFunction(() => {
    const btns = Array.from(document.querySelectorAll('a.o-btn'));
    return btns.some(b => (b.textContent || '').trim().toLowerCase() === 'rate all plans' && b.offsetParent !== null);
  }, { timeout: 15000 });

  // --- Click the correct "Rate All Plans" button safely ---
  const rateAllClicked = await $page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const links = Array.from(document.querySelectorAll('a.o-btn'));
    const target = links.find(a => norm(a.textContent) === 'rate all plans' && a.offsetParent !== null);
    if (!target) return false;

    target.scrollIntoView({ block: 'center' });
    // simulate full user click sequence for Angular binding
    const evOpts = { bubbles: true, cancelable: true };
    target.dispatchEvent(new MouseEvent('mouseover', evOpts));
    target.dispatchEvent(new MouseEvent('mousedown', evOpts));
    target.dispatchEvent(new MouseEvent('mouseup', evOpts));
    target.dispatchEvent(new MouseEvent('click', evOpts));
    return true;
  });

  if (!rateAllClicked) {
    throw new Error('Could not find or trigger the "Rate All Plans" button.');
  } // adjust as needed

  await new Promise(r => setTimeout(r, 60000));

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

  const BLOB_HOOK = () => {
    (function () {
      const origCreate = URL.createObjectURL.bind(URL);

      // Per-document queue for captured PDF byte arrays (as plain number[])
      Object.defineProperty(window, '__pdfQueues__', {
        value: [],
        writable: false, configurable: false, enumerable: false
      });

      function pushPdfBytes(u8) {
        try { window.__pdfQueues__.push(Array.from(u8)); } catch (_) { }
      }

      URL.createObjectURL = function (blob) {
        try {
          if (blob && typeof blob.type === 'string' && /pdf/i.test(blob.type)) {
            const r = new FileReader();
            r.onload = () => {
              try { pushPdfBytes(new Uint8Array(r.result)); } catch (_) { }
            };
            r.readAsArrayBuffer(blob);
          }
        } catch (_) { }
        return origCreate(blob);
      };
    })();
  };

  // 1) Install hook on the CURRENT page for any same-tab blob document loads
  if ($page.evaluateOnNewDocument) {
    await $page.evaluateOnNewDocument(BLOB_HOOK);
  } else {
    // Fallback: inject immediately (will still catch many SPA flows)
    await $page.evaluate(BLOB_HOOK).catch(() => { });
  }

  // 2) Prepare to hook the POPUP as soon as it's created (before it navigates)
  const popupPromise = new Promise(resolve => {
    $page.once('popup', async (p) => {
      try {
        if (p.evaluateOnNewDocument) {
          await p.evaluateOnNewDocument(BLOB_HOOK);
        } else {
          // fallback if method missing
          await p.evaluate(BLOB_HOOK).catch(() => { });
        }
      } catch (_) { }
      resolve(p);
    });
  });

  // 3) Open the menu and click the print option
  await $page.waitForSelector('#tooltipLauncherPrint', { timeout: 10000 });
  await $page.$eval('#tooltipLauncherPrint', el => { el.scrollIntoView({ block: 'center' }); el.click(); });
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
  } catch (_) { }

  // 5) Allow time for blob creation & viewer init
  if (newTab) {
    await newTab.bringToFront().catch(() => { });
    await Promise.race([
      newTab.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { }),
      newTab.waitForSelector('body', { timeout: 15000 }).catch(() => { }),
      sleep(2000)
    ]);
  } else {
    await Promise.race([
      $page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => { }),
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
  const mainBufs = await pullFrom($page);
  const popupBufs = newTab ? await pullFrom(newTab) : [];
  const allBufs = mainBufs.concat(popupBufs).filter(b => b && b.length);

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
              buf.slice(0, 5).toString('ascii') === '%PDF-';
            if (looksPdf) pdfs.push({ buf });
          } catch (_) { }
        };
        page.on('response', handler);
        resolve({
          stop: () => page.off('response', handler),
          best: () => pdfs.sort((a, b) => (b.buf.length) - (a.buf.length))[0] || null
        });
      });
    }

    const mainCatch = await armPdfCatcher($page);
    const popCatch = newTab ? await armPdfCatcher(newTab) : null;

    // Let any late requests finish
    await sleep(2000);

    const bestNet = [popCatch && popCatch.best(), mainCatch.best()].filter(Boolean)
      .sort((a, b) => b.buf.length - a.buf.length)[0] || null;
    mainCatch.stop(); if (popCatch) popCatch.stop();

    if (!bestNet) {
      throw new Error('No Blob-captured PDF found and no PDF-like network response. The app may be opening print-HTML.');
    }
    allBufs.push(bestNet.buf);
  }

  // 7) Choose the biggest buffer and return as n8n binary (Input Binary Field = "proposal")
  allBufs.sort((a, b) => b.length - a.length);
  const best = allBufs[0];

  const now = new Date();
  const fileFormattedDate = [
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    now.getFullYear()
  ].join('');

  // 2️⃣ Construct filename like "10282025 Duke Rateau auto insurance quote.pdf"
  const fileName = `${fileFormattedDate} ${firstName} ${lastName} auto insurance quote.pdf`;

  return [{
    json: { message: 'PDF captured successfully', email: '{{ $json.body.zoho_r_data.email }}', licenseNo: licenseNo },
    binary: {
      proposal: {
        data: best.toString('base64'),
        mimeType: 'application/pdf',
        fileName: `${licenseNo}.pdf`
      }
    }
  }];

  // Take a screenshot after the page has loaded 
  const sss = 'C:/InsuranceQuote/screenshot.png';
  await $page.screenshot({ path: sss, fullPage: true });

  return [{
    json: { message: 'PDF captured successfully', licenseNo: licenseNo },
  }];

}
else {

  await $page.waitForSelector('.sm-popup.is-active', { timeout: 30000 });

  const clicked = await $page.evaluate(() => {
    const container = document.querySelector('.sm-popup.is-active');
    if (!container) return false;

    const btns = Array.from(container.querySelectorAll('button.o-btn'));
    const target = btns.find(b => (b.textContent || '').trim().includes('Create Manually'));
    if (target) { target.click(); return true; }
    return false;
  });

  // await new Promise((resolve) => setTimeout(resolve, 10000));

  // Wait for the input field to be available
  await $page.waitForSelector('#driverFirstName', { timeout: 10000 });

  const firstName = '{{ $json.body.step_4_driver_first_name_1 }}';
  const lastName = '{{ $json.body.step_4_driver_last_name_1 }}';

  // Fill out the form on the next page
  await $page.type('#driverFirstName', firstName, { delay: 30 });
  await $page.type('#driverLastName', lastName, { delay: 30 });
 
  const dobFormatted = formatDateToMMDDYYYY(dateStr);
  await $page.click('#driverDateOfBirth', { clickCount: 3 });
  await $page.keyboard.type(dobFormatted, { delay: 150 });
  await $page.keyboard.press('Tab');
  
  await $page.waitForSelector('#driverRelationshipToInsured', { timeout: 10000 });
  await $page.click('#driverRelationshipToInsured', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('Insured', { delay: 100 });
  await $page.keyboard.press('Tab');

  const firstLicenseNo = '{{ $json.body.step_3_data.date_of_first_licensed }}';
  if (firstLicenseNo) {
    const firstLicenseFormatted = formatDateToMMDDYYYY(firstLicenseNo);
    await $page.type('#driverFirstLicensed', firstLicenseFormatted, { delay: 100 });
    await $page.keyboard.press('Tab');
  }

  await $page.type('#driverLicenseNumber', '{{ $json.body.step_4_driver_license_number_1 }}', { delay: 30 });
  await $page.waitForSelector('#driverSdip', { visible: true });
  await $page.type('#driverSdip', '00', { delay: 30 });
  await $page.keyboard.press('Tab');

  // Click the "Vehicles" tab
  await $page.click('.tabs__list .tabs__item a[href*="vehicles"]');
  await new Promise(r => setTimeout(r, 1000));

  const vehicleVin = '{{ $json.body.step_5_vehicle_identification_number_1 }}';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // Only execute Puppeteer actions if VIN exists and is not empty
  if (vehicleVin && vehicleVin.trim() !== '') {
    // Wait for the 'vehicleVin' input field to be available
    await $page.waitForSelector('#vehicleVin', { timeout: 300 });

    // Focus and clear any pre-existing value
    await $page.click('#vehicleVin', { clickCount: 3 });
    await $page.keyboard.press('Backspace');

    // Type the new value into the input field
    await $page.keyboard.type(vehicleVin, { delay: 100 });
    await $page.keyboard.press('Tab');
    await new Promise(r => setTimeout(r, 500));
  }
  else {


    async function openSelectLike($page, inputSel) {
      await $page.waitForSelector(inputSel, { timeout: 30000 });
      await $page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), inputSel);

      await $page.click(inputSel).catch(() => { });
      await $page.focus(inputSel).catch(() => { });

      // remove readonly if present
      await $page.evaluate((s) => { const el = document.querySelector(s); if (el) el.removeAttribute('readonly'); }, inputSel);

      // try common open gestures
      await $page.keyboard.press('ArrowDown').catch(() => { });
      await $page.keyboard.press('Alt+ArrowDown').catch(() => { });
      await $page.keyboard.press('Space').catch(() => { });

      // try clicking a caret/toggle near the input
      await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return;
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper') || el.parentElement;
        const btn = root && root.querySelector('button,[role="button"],.icon-chevron,.icon-caret,.autocomplete__btn,.sm-input-select__btn');
        if (btn) btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }, inputSel);
    }

    /**
     * Try to pick an option rendered NEAR the input (same wrapper), then ANYWHERE.
     * No 'visible:true' requirements; we filter by visibility manually.
     */
    async function pickByTextRobust($page, inputSel, text) {
      const nearSelectors = [
        '.sm-input-select__menu .sm-input-select__option',
        '.autocomplete__menu .autocomplete__item',
        'ul li', 'li', '[role="option"]', '[data-option]', '.option', '.item'
      ];
      const globalSelectors = [
        // global overlays & libs
        '.cdk-overlay-container [role="option"]',
        '.cdk-overlay-pane [role="option"]',
        '.mat-select-panel .mat-option',
        '.ng-dropdown-panel .ng-option',
        '.ng-select .ng-option',
        // your original guesses
        '.sm-input-select__menu .sm-input-select__option',
        '.autocomplete__menu .autocomplete__item',
        // very generic dropdowns
        '.dropdown-menu .dropdown-item',
        '[role="listbox"] [role="option"]',
        '[role="option"]',
      ];

      // 1) Search relative to the input
      const clickedNear = await $page.evaluate((s, target, sels) => {
        const norm = (x) => (x || '').trim().toLowerCase();
        const host = document.querySelector(s);
        if (!host) return false;
        const root = host.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form, div') || host.parentElement || document.body;

        for (const sel of sels) {
          const nodes = Array.from(root.querySelectorAll(sel));
          const visible = nodes.filter(n => !!(n.offsetParent || n.getClientRects().length));
          if (!visible.length) continue;

          const exact = visible.find(n => norm(n.textContent) === norm(target));
          if (exact) { exact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); exact.click(); return true; }

          const part = visible.find(n => norm(n.textContent).includes(norm(target)));
          if (part) { part.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); part.click(); return true; }
        }
        return false;
      }, inputSel, text, nearSelectors);

      if (clickedNear) return true;

      // 2) Global search (overlays, portals). No visible:true; we filter manually.
      const clickedGlobal = await $page.evaluate((target, sels) => {
        const norm = (x) => (x || '').trim().toLowerCase();

        const getVisibleNodes = (selector) => {
          const all = Array.from(document.querySelectorAll(selector));
          return all.filter(n => !!(n.offsetParent || n.getClientRects().length));
        };

        for (const sel of sels) {
          const visible = getVisibleNodes(sel);
          if (!visible.length) continue;

          const exact = visible.find(n => norm(n.textContent) === norm(target));
          if (exact) { exact.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); exact.click(); return true; }

          const part = visible.find(n => norm(n.textContent).includes(norm(target)));
          if (part) { part.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); part.click(); return true; }
        }
        return false;
      }, text, globalSelectors);

      if (clickedGlobal) return true;

      // 3) Keyboard fallback (first option)
      try {
        await $page.keyboard.press('ArrowDown');
        await $page.keyboard.press('Enter');
        return true;
      } catch { /* ignore */ }

      return false;
    }

    // Convenience: fill a select-like field
    async function fillSelectLike($page, inputSel, value) {
      await openSelectLike($page, inputSel);

      // Clear + type value (some UIs require >=2 chars before options appear)
      await $page.click(inputSel, { clickCount: 3 }).catch(() => { });
      for (let i = 0; i < 8; i++) { try { await $page.keyboard.press('Backspace'); } catch { } }
      await $page.type(inputSel, value, { delay: 70 });

      // small grace period for API-loaded lists
      await sleep(400);

      const ok = await pickByTextRobust($page, inputSel, value);
      // commit
      await $page.keyboard.press('Tab').catch(() => { });
      return ok;
    }

    // ----------------- USAGE -----------------

    // Always do Year -> Make -> Model in order
    // await fillSelectLike($page, '#vehicleYear', '{{ $json.body.step_5_vehicle_year_1 }}');
    // await fillSelectLike($page, '#vehicleMake', '{{ $json.body.step_5_vehicle_make_1 }}');
    // const picked = await fillSelectLike($page, '#vehicleModel', '{{ $json.body.step_5_vehicle_model_1 }}');
    await fillSelectLike($page, '#vehicleYear', '2016');
    await fillSelectLike($page, '#vehicleMake', 'Subaru');
    const picked = await fillSelectLike($page, '#vehicleModel', 'OUTBACK');

    if (!picked) {
      // Debug snapshot around the model field to see what’s actually rendered
      const debugHTML = await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'input not found';
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form') || document.body;
        return root.outerHTML.slice(0, 15000); // limit size
      }, '#vehicleModel');
    }

    await sleep(700);

    // ---- Trim selection with a retry ----
    async function fillTrim(value) {
      // first attempt
      let ok = await fillSelectLike($page, '#vehicleTrim', value);
      if (ok) return true;

      // small pause + second attempt (some APIs are slow)
      await sleep(800);
      ok = await fillSelectLike($page, '#vehicleTrim', value);
      return ok;
    }

    const trimValue = '{{ $json.body.step_5_reg_type_1 }}'; // <-- set your target trim label here
    const trimPicked = await fillTrim(trimValue);

    // Optional debug if still not picked
    if (!trimPicked) {
      const debugHTML = await $page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return 'trim input not found';
        const root = el.closest('.sm-input-select, .autocomplete, .ng-select, .mat-select, .dropdown, .select-wrapper, form') || document.body;
        return root.outerHTML.slice(0, 20000);
      }, '#vehicleTrim');
    }
  }

  // Wait for and fill the 'vehicleLocationAddress1' input
  await $page.waitForSelector('#vehicleLocationAddress1', { timeout: 10000 });
  await $page.click('#vehicleLocationAddress1', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('{{ $json.body.step_1_data.address1 }}', { delay: 100 });

  // Wait for and fill the 'vehicleLocationCity' input
  await $page.waitForSelector('#vehicleLocationCity', { timeout: 10000 });
  await $page.click('#vehicleLocationCity', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('{{ $json.body.step_1_data.city }}', { delay: 100 });

  // Wait for and fill the 'vehicleLocationZip' input
  await $page.waitForSelector('#vehicleLocationZip', { timeout: 10000 });

  // Focus the input and clear any pre-existing value
  await $page.click('#vehicleLocationZip', { clickCount: 3 });
  await $page.keyboard.press('Backspace');

  // Type the valid ZIP code '02142'
  await $page.keyboard.type('{{ $json.body.step_1_data.zip }}', { delay: 100 });

  // Ensure the value is accepted by dispatching events manually (to trigger pattern validation)
  await $page.evaluate(() => {
    const input = document.querySelector('#vehicleLocationZip');
    if (input) {
      input.value = '{{ $json.body.step_1_data.zip }}';
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
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Click the "Options" tab (using partial href match)
  await $page.click('.tabs__list .tabs__item a[href*="options"]');

  // 1. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#priorOrRenewingCarrier', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('Other', { delay: 100 });
  await $page.keyboard.press('Tab');

  //Get the raw date string from your JSON
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const optionDate = `${String(nextYear.getMonth() + 1).padStart(2, '0')}/${String(nextYear.getDate()).padStart(2, '0')}/${nextYear.getFullYear()}`; // e.g., "11-May-1995
  const optionDobFormatted = formatDateToMMDDYYYY(optionDate);

  //Only continue if we have a valid formatted date
  if (optionDobFormatted) {
    const dobSelector = 'input.datepicker-input__input';

    // Wait for the date input to appear
    await $page.waitForSelector(dobSelector, { visible: true, timeout: 10000 });

    // Clear old value (many datepickers use masks)
    await $page.click(dobSelector, { clickCount: 3 }).catch(() => { });
    for (let i = 0; i < 12; i++) { try { await $page.keyboard.press('Backspace'); } catch { } }

    // Type the date slowly so mask/formatting can process each digit
    await $page.keyboard.type(optionDobFormatted, { delay: 120 });

    // Trigger validation by tabbing out
    await $page.keyboard.press('Tab');
  } else {
    console.log('No date_of_birth found in JSON — skipping DOB input.');
  }

  //3. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });

  const YEARS_ID = '#yearsWithThisCarrier';

  // 1) Wait until it exists and is visible
  await $page.waitForSelector(YEARS_ID, { timeout: 15000 });
  await $page.$eval(YEARS_ID, el => el.scrollIntoView({ block: 'center' }));

  // 2) Try real typing first (many inputs require key events)
  await $page.focus(YEARS_ID);
  await $page.keyboard.down('Control').catch(() => { });
  await $page.keyboard.press('KeyA').catch(() => { });  // Ctrl+A
  await $page.keyboard.up('Control').catch(() => { });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('6', { delay: 80 });
  await $page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 300));

  // Check if value stuck
  let yearsVal = await $page.$eval(YEARS_ID, el => el.value || el.getAttribute('value') || '');
  if (yearsVal !== '6') {
    // 3) Open the autocomplete dropdown and click the option "6"
    const opened = await $page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const root = input.closest('.autocomplete') || input.parentElement;
      const toggle = root && root.querySelector('.autocomplete__btn-toggle');
      if (toggle) { toggle.click(); return true; }
      // Some builds open on input click
      input.click();
      return true;
    }, YEARS_ID);

    if (opened) {
      // wait for listbox to render (cover common variants)
      await $page.waitForSelector('.autocomplete__list, [role="listbox"], .cdk-overlay-container', { timeout: 5000 }).catch(() => { });

      // click an option that is exactly "6" or starts with "6"
      const picked = await $page.evaluate(() => {
        const norm = s => (s || '').replace(/\s+/g, ' ').trim();
        const candidates = [
          ...document.querySelectorAll('.autocomplete__list *'),
          ...document.querySelectorAll('[role="listbox"] *'),
          ...document.querySelectorAll('.cdk-overlay-container [role="option"], .cdk-overlay-container *')
        ];
        const target = candidates.find(el => /^6\b/.test(norm(el.textContent)));
        if (target) { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); target.click(); return true; }
        return false;
      });

      await new Promise(r => setTimeout(r, 250));
      yearsVal = await $page.$eval(YEARS_ID, el => el.value || el.getAttribute('value') || '');
      if (!picked || yearsVal !== '6') {
        // 4) Fallback: set hidden backing input + fire events
        await $page.evaluate((sel) => {
          const input = document.querySelector(sel);
          if (!input) return;
          const hidden = document.querySelector(`${sel}_value`) || input; // many components use *_value
          hidden.value = '6';
          hidden.dispatchEvent(new Event('input', { bubbles: true }));
          hidden.dispatchEvent(new Event('change', { bubbles: true }));
          input.value = '6';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }, YEARS_ID);
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  // Final blur to seal it
  await $page.keyboard.press('Tab').catch(() => { });
  await new Promise(r => setTimeout(r, 150));




  // 2. Fill the 'yearsWithCurrentAgency' input field with "0"
  await $page.waitForSelector('#yearsWithCurrentAgency', { timeout: 10000 });
  await $page.click('#yearsWithCurrentAgency', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('6', { delay: 100 });
  await $page.keyboard.press('Tab');

  //3. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#lapsedDaysLast12Months', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('0', { delay: 100 });
  await $page.keyboard.press('Tab');

  //4. Fill the 'priorOrRenewingCarrier' input await $page.waitForSelector('#priorOrRenewingCarrier', { timeout: 10000 });
  await $page.click('#priorBodilyInjurylimits', { clickCount: 3 });
  await $page.keyboard.press('Backspace');
  await $page.keyboard.type('100/300', { delay: 100 });
  await $page.keyboard.press('Tab');

  await new Promise((resolve) => setTimeout(resolve, 1000));

  // MAPFRE "Length of Time for Continuous Coverage" — click the icon to check
  const BASE_ID = 'BSC-AUTO-002400_MAPFRELengthofTimeforContinuousCoverage';
  const SEL_ITEM = `#${BASE_ID}`;
  const SEL_INPUT = `#${BASE_ID}_checkbox`;
  const SEL_ICON = `#${BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  // Scroll into view and check if the checkbox is already checked
  await $page.$eval(SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' })).catch(() => { });

  // Check if the checkbox is already checked
  let checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);

  if (checked) {
    console.log('Checkbox is already checked, skipping...');
  } else {
    // If not checked, try clicking the icon, label, or force-check
    try {
      await $page.waitForSelector(SEL_ICON, { timeout: 2000 });
      await $page.click(SEL_ICON, { delay: 20 });
      await sleep(150);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    } catch (_) { }

    if (!checked) {
      await $page.click(`${SEL_ITEM} label.o-checkable`).catch(() => { });
      await sleep(150);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    }

    if (!checked) {
      await $page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        try { el.click(); } catch (e) { }
        if (!el.checked) el.checked = true;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, SEL_INPUT);
      await sleep(120);
      checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
    }

    if (!checked) {
      // coordinate click as last resort
      const h = await $page.$(SEL_ICON) || await $page.$(`${SEL_ITEM} label.o-checkable`);
      if (h) {
        const box = await h.boundingBox();
        if (box) {
          await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await sleep(150);
          checked = await $page.$eval(SEL_INPUT, el => !!el.checked).catch(() => false);
        }
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
    if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
    else { target.scrollIntoView({ block: 'center' }); try { target.click(); } catch (e) { } }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!last.checked) last.checked = true;
      last.dispatchEvent(new Event('input', { bubbles: true }));
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



  // --- Travelers "Continuous Insurance" — click the checkbox to open modal ---
  const TRAVELERS_BASE_ID = 'BSC-AUTO-002195_TravelersContinuousInsurance';
  const TRAVELERS_SEL_ITEM = `#${TRAVELERS_BASE_ID}`;
  const TRAVELERS_SEL_INPUT = `#${TRAVELERS_BASE_ID}_checkbox`;
  const TRAVELERS_SEL_ICON = `#${TRAVELERS_BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  await $page.waitForSelector(TRAVELERS_SEL_ITEM, { timeout: 15000 });
  await $page.$eval(TRAVELERS_SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' }));

  // Try clicking the styled <i> icon (preferred)
  let travelersToggledIcon = false;
  try {
    await $page.waitForSelector(TRAVELERS_SEL_ICON, { timeout: 2000 });
    await $page.click(TRAVELERS_SEL_ICON, { delay: 20 });
    travelersToggledIcon = true;
  } catch (_) { }

  // Fallback: click the label wrapper
  if (!travelersToggledIcon) {
    await $page.click(`${TRAVELERS_SEL_ITEM} label.o-checkable`).catch(() => { });
  }

  // Give UI time to react
  await new Promise(r => setTimeout(r, 150));

  // Check state
  let travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);

  // Last resort: force-check and fire events so Angular updates bindings
  if (!travelersChecked) {
    await $page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      try { el.click(); } catch (e) { }
      if (!el.checked) el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, TRAVELERS_SEL_INPUT);

    await new Promise(r => setTimeout(r, 100));
    travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);
  }

  // Optional coordinate click (rare overlays)
  if (!travelersChecked) {
    const handle = await $page.$(TRAVELERS_SEL_ICON) || await $page.$(`${TRAVELERS_SEL_ITEM} label.o-checkable`);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 100));
        travelersChecked = await $page.$eval(TRAVELERS_SEL_INPUT, el => !!el.checked).catch(() => false);
      }
    }
  }

  // --- Select the radio option inside the Travelers modal ---
  await $page.waitForSelector('label.o-checkable input[name="parsedItemOption"]', { timeout: 15000 });

  // Try by visible text ("Less than 3 years")
  let travelersPickedOption = await $page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const reLess3 = /less\s+than\s+3\s+years?/i;

    const labels = Array.from(document.querySelectorAll('label.o-checkable'));
    const target = labels.find(l => {
      const txt = norm(l.innerText || l.textContent);
      return reLess3.test(txt);
    });
    if (!target) return false;

    const icon = target.querySelector('i.o-btn.o-btn--radio');
    if (icon) {
      icon.scrollIntoView({ block: 'center' });
      try { icon.click(); } catch (e) { }
    } else {
      target.scrollIntoView({ block: 'center' });
      try { target.click(); } catch (e) { }
    }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  });

  if (!travelersPickedOption) {
    // Fallback: click the first radio if text match not found
    const travelersClickedFirst = await $page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
      if (!items.length) return false;
      const first = items[0];
      const label = first.closest('label.o-checkable');
      if (!label) return false;

      const icon = label.querySelector('i.o-btn.o-btn--radio');
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!first.checked) first.checked = true;
      first.dispatchEvent(new Event('input', { bubbles: true }));
      first.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (!travelersClickedFirst) {
      throw new Error('Could not find/select the >=6 months & <1 yr option.');
    }
  }

  // Optional: verify selection & log which one is checked
  const travelersSelectedText = await $page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
    const checked = radios.find(r => r.checked);
    if (!checked) return '';
    const label = checked.closest('label.o-checkable');
    const span = label && label.querySelector('span');
    return (span && span.textContent || '').trim();
  });
  console.log('Travelers selected option:', travelersSelectedText);

  // --- Click the "Save" button inside the Travelers modal ---
  await $page.waitForSelector('.o-btn.u-spacing--right-2', { timeout: 10000 });

  const travelersSaveClicked = await $page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.o-btn.u-spacing--right-2'));
    const saveBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'save');
    if (saveBtn) {
      saveBtn.scrollIntoView({ block: 'center' });
      saveBtn.click();
      return true;
    }
    return false;
  });

  // optional: wait for modal close
  await $page.waitForFunction(
    () => !document.querySelector('.modalbox__content, .box--silver, [role="dialog"]'),
    { timeout: 10000 }
  ).catch(() => console.log('Travelers modal did not close within 10s (continuing)'));


  // --- Travelers "Primary Residence Type" — click the checkbox to open modal ---
  const TRAVELERS_RES_BASE_ID = 'BSC-AUTO-002152_TravelersPrimaryResidenceType';
  const TRAVELERS_RES_SEL_ITEM = `#${TRAVELERS_RES_BASE_ID}`;
  const TRAVELERS_RES_SEL_INPUT = `#${TRAVELERS_RES_BASE_ID}_checkbox`;
  const TRAVELERS_RES_SEL_ICON = `#${TRAVELERS_RES_BASE_ID}_checkbox + i.o-btn.o-btn--checkbox`;

  await $page.waitForSelector(TRAVELERS_RES_SEL_ITEM, { timeout: 15000 });
  await $page.$eval(TRAVELERS_RES_SEL_ITEM, el => el.scrollIntoView({ block: 'center', inline: 'center' }));

  // Try clicking the styled <i> icon (preferred)
  let travelersResToggledIcon = false;
  try {
    await $page.waitForSelector(TRAVELERS_RES_SEL_ICON, { timeout: 2000 });
    await $page.click(TRAVELERS_RES_SEL_ICON, { delay: 20 });
    travelersResToggledIcon = true;
  } catch (_) { }

  // Fallback: click the label wrapper
  if (!travelersResToggledIcon) {
    await $page.click(`${TRAVELERS_RES_SEL_ITEM} label.o-checkable`).catch(() => { });
  }

  // Wait briefly for UI reaction
  await new Promise(r => setTimeout(r, 150));

  // Check state
  let travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);

  // Last resort: force-check and dispatch events
  if (!travelersResChecked) {
    await $page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      try { el.click(); } catch (e) { }
      if (!el.checked) el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, TRAVELERS_RES_SEL_INPUT);

    await new Promise(r => setTimeout(r, 100));
    travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);
  }

  // Optional coordinate click fallback
  if (!travelersResChecked) {
    const handle = await $page.$(TRAVELERS_RES_SEL_ICON) || await $page.$(`${TRAVELERS_RES_SEL_ITEM} label.o-checkable`);
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        await $page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await new Promise(r => setTimeout(r, 100));
        travelersResChecked = await $page.$eval(TRAVELERS_RES_SEL_INPUT, el => !!el.checked).catch(() => false);
      }
    }
  }

  // --- Select the radio option inside the Travelers Residence modal ---
  await $page.waitForSelector('label.o-checkable input[name="parsedItemOption"]', { timeout: 15000 });

  // Try by visible text ("Other")
  let travelersResPickedOption = await $page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const reOther = /^other$/i;

    const labels = Array.from(document.querySelectorAll('label.o-checkable'));
    const target = labels.find(l => {
      const txt = norm(l.innerText || l.textContent);
      return reOther.test(txt);
    });
    if (!target) return false;

    const icon = target.querySelector('i.o-btn.o-btn--radio');
    if (icon) {
      icon.scrollIntoView({ block: 'center' });
      try { icon.click(); } catch (e) { }
    } else {
      target.scrollIntoView({ block: 'center' });
      try { target.click(); } catch (e) { }
    }

    const input = target.querySelector('input[type="radio"][name="parsedItemOption"]');
    if (input) {
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  });

  if (!travelersResPickedOption) {
    // Fallback: click the first radio option
    const travelersResClickedFirst = await $page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
      if (!items.length) return false;
      const first = items[0];
      const label = first.closest('label.o-checkable');
      if (!label) return false;

      const icon = label.querySelector('i.o-btn.o-btn--radio');
      if (icon) { icon.scrollIntoView({ block: 'center' }); try { icon.click(); } catch (e) { } }
      else { label.scrollIntoView({ block: 'center' }); try { label.click(); } catch (e) { } }

      if (!first.checked) first.checked = true;
      first.dispatchEvent(new Event('input', { bubbles: true }));
      first.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });

    if (!travelersResClickedFirst) {
      throw new Error('Could not find/select the "Other" option.');
    }
  }

  // Optional: verify selection
  const travelersResSelectedText = await $page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('label.o-checkable input[name="parsedItemOption"]'));
    const checked = radios.find(r => r.checked);
    if (!checked) return '';
    const label = checked.closest('label.o-checkable');
    const span = label && label.querySelector('span');
    return (span && span.textContent || '').trim();
  });

  // --- Click the "Save" button inside the Travelers Residence modal ---
  await $page.waitForSelector('.o-btn.u-spacing--right-2', { timeout: 10000 });

  const travelersResSaveClicked = await $page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button.o-btn.u-spacing--right-2'));
    const saveBtn = btns.find(b => (b.textContent || '').trim().toLowerCase() === 'save');
    if (saveBtn) {
      saveBtn.scrollIntoView({ block: 'center' });
      saveBtn.click();
      return true;
    }
    return false;
  });

  // optional: wait for modal to close
  await $page.waitForFunction(
    () => !document.querySelector('.modalbox__content, .box--silver, [role="dialog"]'),
    { timeout: 10000 }
  ).catch(() => console.log('Travelers Residence modal did not close within 10s (continuing)'));



  // Take a screenshot after the page has loaded 
  const sss = 'C:/InsuranceQuote/screenshot.png';
  await $page.screenshot({ path: sss, fullPage: true });

  return [{
    json: { message: 'PDF captured successfully', licenseNo: licenseNo },
  }];
}