// ============================================================
// ENHANCED HAWKSOFT TO GHL TRANSFORMATION - V3
// ClientCircle-Style Marketing Tags & Segmentation
// ============================================================

const hawksoftClient = $input.item.json;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function safeGet(obj, path, defaultValue = "") {
  try {
    const keys = path.split(".");
    let result = obj;
    for (const key of keys) {
      result = result?.[key];
      if (result === undefined || result === null) return defaultValue;
    }
    return result || defaultValue;
  } catch (error) {
    return defaultValue;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatPhone(phone) {
  if (!phone) return "";
  const cleaned = phone.replace(/\D/g, "");
  return cleaned.length === 10 ? `+1${cleaned}` : phone;
}

function cleanEmail(email) {
  if (!email) return "";
  const cleaned = String(email).trim().toLowerCase();
  return cleaned.includes("@") && cleaned.includes(".") ? cleaned : "";
}

function formatDate(date) {
  if (!date) return "";
  try {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
  } catch (error) {
    return "";
  }
}

function cleanString(str) {
  if (!str) return "";
  return String(str).trim();
}

function formatCurrency(amount) {
  if (!amount) return "";
  const num = parseFloat(amount);
  return isNaN(num) ? "" : num.toFixed(2);
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2 - d1);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function calculateAge(birthDate) {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// ============================================================
// EXTRACT CLIENT INFO
// ============================================================

const details = safeGet(hawksoftClient, "details", {});
const isPersonal = safeGet(details, "isPersonal", false);
const isCommercial = safeGet(details, "isCommercial", false);
const clientStatus = cleanString(safeGet(details, "status", "Prospect"));

// Get addresses
const mailingAddr = safeGet(details, "mailingAddress", {});
const physicalAddr = safeGet(details, "physicalAddress", {});
const address = mailingAddr.address1 ? mailingAddr : physicalAddr;

// ============================================================
// HANDLE MULTIPLE PEOPLE - Get Primary Contact
// ============================================================

const people = safeArray(safeGet(hawksoftClient, "people", []));
const mainContactIds = safeArray(safeGet(details, "mainContacts", []));

// Find primary person (first mainContact or first person in array)
let primaryPerson = null;
if (mainContactIds.length > 0) {
  primaryPerson = people.find((p) => p.id === mainContactIds[0]);
}
if (!primaryPerson && people.length > 0) {
  primaryPerson = people[0];
}
primaryPerson = primaryPerson || {};

const firstName = cleanString(safeGet(primaryPerson, "firstName", ""));
const lastName = cleanString(safeGet(primaryPerson, "lastName", ""));
const primaryPersonAge = calculateAge(
  safeGet(primaryPerson, "dateOfBirth", ""),
);

// Collect all people and extract their information
const peopleData = people.map((p) => ({
  fullName: `${cleanString(safeGet(p, "firstName", ""))} ${cleanString(safeGet(p, "lastName", ""))}`,
  dateOfBirth: formatDate(safeGet(p, "dateOfBirth", "")),
  occupation: cleanString(safeGet(p, "occupation", "")),
  gender: cleanString(safeGet(p, "gender", "")),
  relationship: cleanString(safeGet(p, "relationship", "")),
  firstName: cleanString(safeGet(p, "firstName", "")),
  lastName: cleanString(safeGet(p, "lastName", "")),
}));

// Collect all people names for reference
const allPeopleNames = people
  .map((p) =>
    `${cleanString(safeGet(p, "firstName", ""))} ${cleanString(safeGet(p, "lastName", ""))}`.trim(),
  )
  .filter((name) => name)
  .join(", ");

// ============================================================
// EXTRACT CONTACT INFO (Email, Phone) - From Primary Person
// ============================================================

const contacts = safeArray(safeGet(hawksoftClient, "contacts", []));
const primaryPersonId = safeGet(primaryPerson, "id", "");

// Find primary person's email and phone
const primaryEmail =
  contacts.find(
    (c) =>
      (c.personId === primaryPersonId || c.personId === null) &&
      safeGet(c, "type", "").toLowerCase().includes("email"),
  ) || {};
const primaryPhone =
  contacts.find(
    (c) =>
      (c.personId === primaryPersonId || c.personId === null) &&
      safeGet(c, "type", "").toLowerCase().includes("phone"),
  ) || {};

const email = cleanEmail(safeGet(primaryEmail, "data", ""));
const phone = formatPhone(safeGet(primaryPhone, "data", ""));
const allowMassEmail = safeGet(primaryEmail, "allowMassEmail", false);

// ============================================================
// INITIALIZE GHL CONTACT
// ============================================================

const ghlContact = {
  firstName: firstName || "Unknown",
  lastName: lastName || "Contact",
  email: email,
  phone: phone,
  dateOfBirth: formatDate(safeGet(primaryPerson, "dateOfBirth", "")),
  address1: cleanString(safeGet(address, "address1", "")),
  city: cleanString(safeGet(address, "city", "")),
  state: cleanString(safeGet(address, "state", "")),
  postalCode: cleanString(safeGet(address, "zip", "")),
  country: safeGet(address, "countryCode", "US") || "US",
  source: "Hawksoft Integration",
  tags: ["HS Lead"],
  customFields: {}, // Will convert to array at the end
};

if (!email) delete ghlContact.email;
if (!phone) delete ghlContact.phone;

// ============================================================
// BASIC CUSTOM FIELDS
// ============================================================

// For each person, include their relevant info in custom fields (add this section)
peopleData.forEach((person, index) => {
  ghlContact.customFields[`person${index + 1}_first_name`] = person.firstName;
  ghlContact.customFields[`person${index + 1}_last_name`] = person.lastName;
  ghlContact.customFields[`person${index + 1}_dob`] = person.dateOfBirth;
  ghlContact.customFields[`person${index + 1}_occupation`] = person.occupation;
  ghlContact.customFields[`person${index + 1}_gender`] = person.gender;
  ghlContact.customFields[`person${index + 1}_relationship`] =
    person.relationship;
});

ghlContact.customFields.hawksoft_client_id = String(
  safeGet(hawksoftClient, "clientNumber", ""),
);
ghlContact.customFields.hawksoft_client_guid = cleanString(
  safeGet(details, "id", ""),
);
ghlContact.customFields.hawksoft_last_sync = new Date().toISOString();

// Primary person info
ghlContact.customFields.dob = formatDate(
  safeGet(primaryPerson, "dateOfBirth", ""),
);
ghlContact.customFields.marital_status = cleanString(
  safeGet(primaryPerson, "maritalStatus", ""),
);
ghlContact.customFields.gender = cleanString(
  safeGet(primaryPerson, "gender", ""),
);
ghlContact.customFields.occupation = cleanString(
  safeGet(primaryPerson, "occupation", ""),
);

// All people on account
if (allPeopleNames) {
  ghlContact.customFields.all_people_on_account = allPeopleNames;
}

// Commercial info
if (isCommercial) {
  ghlContact.customFields.company_name = cleanString(
    safeGet(details, "companyName", ""),
  );
  ghlContact.customFields.dba_name = cleanString(
    safeGet(details, "dbaName", ""),
  );
  ghlContact.customFields.business_type = cleanString(
    safeGet(details, "businessType", ""),
  );
}

// Agency info
const producer = cleanString(safeGet(details, "producer", ""));
const csr = cleanString(safeGet(details, "csr", ""));
ghlContact.customFields.producer = producer;
ghlContact.customFields.csr = csr;
ghlContact.customFields.office_id = String(safeGet(details, "officeId", ""));

const clientSinceDate = safeGet(details, "clientSince", "");
ghlContact.customFields.client_since = formatDate(clientSinceDate);

// ============================================================
// BASIC TAGS
// ============================================================

if (isPersonal) ghlContact.tags.push("Personal");
if (isCommercial) ghlContact.tags.push("Commercial");

if (producer) ghlContact.tags.push(`Producer-${producer}`);
if (csr) ghlContact.tags.push(`CSR-${csr}`);

if (safeGet(details, "doNotMarket", false)) {
  ghlContact.tags.push("DND-Marketing");
  ghlContact.dnd = true;
}

if (safeGet(details, "allowCrossSell", false)) {
  ghlContact.tags.push("Allow-CrossSell");
}

// ============================================================
// COMMUNICATION PREFERENCE TAGS
// ============================================================

if (email) {
  ghlContact.tags.push("Email-Verified");
  if (allowMassEmail) {
    ghlContact.tags.push("Email-Campaign-Ready");
  }
} else {
  ghlContact.tags.push("Email-Missing");
}

if (phone) {
  ghlContact.tags.push("Phone-Verified");
  if (!safeGet(details, "doNotMarket", false)) {
    ghlContact.tags.push("SMS-Campaign-Ready");
  }
} else {
  ghlContact.tags.push("Phone-Missing");
}

if (email && phone && !safeGet(details, "doNotMarket", false)) {
  ghlContact.tags.push("Marketing-Ready");
} else if (!email && !phone) {
  ghlContact.tags.push("Direct-Mail-Only");
}

// ============================================================
// AGE & DEMOGRAPHIC TAGS
// ============================================================

if (primaryPersonAge !== null) {
  ghlContact.customFields.age = primaryPersonAge;

  if (primaryPersonAge >= 18 && primaryPersonAge <= 25) {
    ghlContact.tags.push("Age-18-25");
  } else if (primaryPersonAge >= 26 && primaryPersonAge <= 35) {
    ghlContact.tags.push("Age-26-35");
  } else if (primaryPersonAge >= 36 && primaryPersonAge <= 45) {
    ghlContact.tags.push("Age-36-45");
  } else if (primaryPersonAge >= 46 && primaryPersonAge <= 55) {
    ghlContact.tags.push("Age-46-55");
  } else if (primaryPersonAge >= 56 && primaryPersonAge <= 65) {
    ghlContact.tags.push("Age-56-65");
  } else if (primaryPersonAge > 65) {
    ghlContact.tags.push("Age-65-Plus");
    ghlContact.tags.push("Senior-Client");
  }
}

// Marital & Family Status Tags
const maritalStatus = cleanString(safeGet(primaryPerson, "maritalStatus", ""));
if (maritalStatus.toLowerCase() === "married") {
  if (primaryPersonAge >= 25 && primaryPersonAge <= 40) {
    ghlContact.tags.push("Young-Family");
  } else if (primaryPersonAge >= 55) {
    ghlContact.tags.push("Empty-Nester");
  }
} else if (maritalStatus.toLowerCase() === "single") {
  if (primaryPersonAge >= 25 && primaryPersonAge <= 35) {
    ghlContact.tags.push("Young-Professional");
  }
}

// Occupation Tags
const occupation = cleanString(
  safeGet(primaryPerson, "occupation", ""),
).toLowerCase();
if (occupation.includes("engineer")) {
  ghlContact.tags.push("Engineer");
} else if (
  occupation.includes("self-employed") ||
  occupation.includes("business owner")
) {
  ghlContact.tags.push("Self-Employed");
} else if (occupation.includes("retired")) {
  ghlContact.tags.push("Retired");
} else if (
  occupation.includes("healthcare") ||
  occupation.includes("doctor") ||
  occupation.includes("nurse")
) {
  ghlContact.tags.push("Healthcare-Professional");
} else if (occupation.includes("military")) {
  ghlContact.tags.push("Military");
}

// ============================================================
// CLIENT RELATIONSHIP DURATION TAGS
// ============================================================

const today = new Date();
if (clientSinceDate) {
  const daysSinceClient = daysBetween(clientSinceDate, today);
  const monthsSinceClient = Math.floor(daysSinceClient / 30);
  const yearsSinceClient = Math.floor(daysSinceClient / 365);

  ghlContact.customFields.client_tenure_days = daysSinceClient;
  ghlContact.customFields.client_tenure_years = yearsSinceClient;

  if (monthsSinceClient < 6) {
    ghlContact.tags.push("New-Client");
  } else if (monthsSinceClient < 24) {
    ghlContact.tags.push("Established-Client");
  } else if (yearsSinceClient < 5) {
    ghlContact.tags.push("Loyal-Client");
  } else {
    ghlContact.tags.push("VIP-Client");
  }
}

// ============================================================
// PROCESS ALL POLICIES - COMPLETE INFORMATION
// ============================================================

const policies = safeArray(safeGet(hawksoftClient, "policies", []));
let hasActivePolicy = false;
let hasExpiredPolicy = false;
let hasProspectPolicy = false;
let hasCancelledPolicy = false;
let totalPremium = 0;
let totalQuotedPremium = 0;

// Track policy types
const policyTypes = {
  auto: 0,
  home: 0,
  earthquake: 0,
  umbrella: 0,
  life: 0,
  commercial: 0,
};

// Track carriers
const carriers = new Set();
const activePolicies = [];
const prospectPolicies = [];
const cancelledPolicies = [];

// Track renewal dates
const upcomingRenewals = [];

policies.forEach((policy, policyIndex) => {
  try {
    const policyNum = policyIndex + 1;

    // Extract all policy fields
    const policyType = cleanString(safeGet(policy, "type", ""));
    const policyTitle = cleanString(safeGet(policy, "title", "")).toUpperCase();
    const policyStatus = cleanString(safeGet(policy, "status", ""));
    const policySubStatus = cleanString(safeGet(policy, "subStatus", ""));
    const policyNumber = cleanString(safeGet(policy, "policyNumber", ""));
    const accountNumber = cleanString(safeGet(policy, "accountNumber", ""));
    const carrier = cleanString(safeGet(policy, "carrier", ""));
    const writingCarrier = cleanString(safeGet(policy, "writingCarrier", ""));
    const applicationType = cleanString(safeGet(policy, "applicationType", ""));
    const source = cleanString(safeGet(policy, "source", ""));

    // Dates
    const effectiveDate = safeGet(policy, "effectiveDate", "");
    const expirationDate = safeGet(policy, "expirationDate", "");
    const inceptionDate = safeGet(policy, "inceptionDate", "");
    const soldDate = safeGet(policy, "soldDate", "");
    const statusDate = safeGet(policy, "statusDate", "");

    // Premium
    const premium = parseFloat(safeGet(policy, "premium", 0)) || 0;
    const quotedPremium = parseFloat(safeGet(policy, "quotedPremium", 0)) || 0;

    // Other info
    const term = cleanString(safeGet(policy, "term", ""));
    const numberOfTerms = safeGet(policy, "numberOfTerms", 0);
    const billingType = cleanString(safeGet(policy, "billingType", ""));
    const paymentPlan = cleanString(safeGet(policy, "paymentPlan", ""));
    const agent1 = cleanString(safeGet(policy, "agent1", ""));
    const agent2 = cleanString(safeGet(policy, "agent2", ""));

    // Track policy status
    const isActive =
      policyStatus.toLowerCase() === "active" ||
      policyStatus.toLowerCase() === "renewal" ||
      policyStatus.toLowerCase() === "inforce";

    const isProspect = policyStatus.toLowerCase() === "prospect";

    const isCancelled =
      policyStatus.toLowerCase() === "cancelled" ||
      policyStatus.toLowerCase() === "nonrenew";

    const isExpired = policyStatus.toLowerCase() === "expired";

    if (isActive) {
      hasActivePolicy = true;
      activePolicies.push({
        type: policyTitle,
        premium: premium,
        expirationDate: expirationDate,
        effectiveDate: effectiveDate,
        carrier: carrier,
      });
    }

    if (isProspect) {
      hasProspectPolicy = true;
      prospectPolicies.push({
        type: policyTitle,
        statusDate: statusDate,
        quotedPremium: quotedPremium,
      });
    }

    if (isCancelled) {
      hasCancelledPolicy = true;
      cancelledPolicies.push({
        type: policyTitle,
        statusDate: statusDate,
        subStatus: policySubStatus,
      });
    }

    if (isExpired) hasExpiredPolicy = true;

    totalPremium += premium;
    totalQuotedPremium += quotedPremium;

    // Track policy types
    if (policyTitle.includes("AUTO")) policyTypes.auto++;
    if (policyTitle.includes("HOME") || policyTitle.includes("HO"))
      policyTypes.home++;
    if (policyTitle.includes("EQ") || policyTitle.includes("EARTHQUAKE"))
      policyTypes.earthquake++;
    if (policyTitle.includes("UMBRELLA") || policyTitle.includes("UMB"))
      policyTypes.umbrella++;
    if (policyTitle.includes("LIFE")) policyTypes.life++;
    if (applicationType.toLowerCase() === "commercial")
      policyTypes.commercial++;

    // Track carriers
    if (carrier && carrier !== "<Prospect>") {
      carriers.add(carrier);
    }

    // Track renewal dates for active policies
    if (isActive && expirationDate) {
      const daysUntilExpiration = daysBetween(today, expirationDate);
      if (daysUntilExpiration >= 0 && daysUntilExpiration <= 90) {
        upcomingRenewals.push({
          type: policyTitle,
          daysUntil: daysUntilExpiration,
          expirationDate: expirationDate,
        });
      }
    }

    // Track effective date for new policies
    if (isActive && effectiveDate) {
      const daysSinceEffective = daysBetween(effectiveDate, today);
      if (daysSinceEffective <= 90) {
        ghlContact.tags.push("New-Policy");
      }
      // if (daysSinceEffective >= 30 && daysSinceEffective <= 60) {
      //   ghlContact.tags.push("Policy-30-Days");
      // }
    }

    // ============================================================
    // STORE POLICY DATA IN CUSTOM FIELDS
    // ============================================================

    const prefix = `policy${policyNum}_`;

    // Core policy info
    if (policyType) ghlContact.customFields[`${prefix}type`] = policyType;
    if (policyTitle) ghlContact.customFields[`${prefix}title`] = policyTitle;
    if (policyStatus) ghlContact.customFields[`${prefix}status`] = policyStatus;
    if (policySubStatus)
      ghlContact.customFields[`${prefix}substatus`] = policySubStatus;
    if (policyNumber) ghlContact.customFields[`${prefix}number`] = policyNumber;
    if (accountNumber)
      ghlContact.customFields[`${prefix}account_number`] = accountNumber;
    if (carrier) ghlContact.customFields[`${prefix}carrier`] = carrier;
    if (writingCarrier)
      ghlContact.customFields[`${prefix}writing_carrier`] = writingCarrier;

    // Dates
    if (effectiveDate)
      ghlContact.customFields[`${prefix}effective_date`] =
        formatDate(effectiveDate);
    if (expirationDate)
      ghlContact.customFields[`${prefix}expiration_date`] =
        formatDate(expirationDate);
    if (inceptionDate)
      ghlContact.customFields[`${prefix}inception_date`] =
        formatDate(inceptionDate);
    if (soldDate)
      ghlContact.customFields[`${prefix}sold_date`] = formatDate(soldDate);
    if (statusDate)
      ghlContact.customFields[`${prefix}status_date`] = formatDate(statusDate);

    // Premium & billing
    if (premium > 0)
      ghlContact.customFields[`${prefix}premium`] = formatCurrency(premium);
    if (quotedPremium > 0)
      ghlContact.customFields[`${prefix}quoted_premium`] =
        formatCurrency(quotedPremium);
    if (billingType)
      ghlContact.customFields[`${prefix}billing_type`] = billingType;
    if (paymentPlan)
      ghlContact.customFields[`${prefix}payment_plan`] = paymentPlan;

    // Other details
    if (applicationType)
      ghlContact.customFields[`${prefix}application_type`] = applicationType;
    if (source) ghlContact.customFields[`${prefix}source`] = source;
    if (term) ghlContact.customFields[`${prefix}term`] = term;
    if (numberOfTerms)
      ghlContact.customFields[`${prefix}number_of_terms`] = numberOfTerms;
    if (agent1) ghlContact.customFields[`${prefix}agent1`] = agent1;
    if (agent2) ghlContact.customFields[`${prefix}agent2`] = agent2;

    // Carrier tags
    if (carrier && carrier !== "<Prospect>") {
      ghlContact.tags.push(`Carrier-${carrier.replace(/\s+/g, "-")}`);
    } else if (carrier === "<Prospect>") {
      ghlContact.tags.push("Prospect-Carrier");
    }

    // Billing tags
    if (billingType.toLowerCase() === "agency") {
      ghlContact.tags.push("Agency-Bill");
    } else if (billingType.toLowerCase() === "direct") {
      ghlContact.tags.push("Direct-Bill");
    }

    if (paymentPlan.toLowerCase() === "monthly") {
      ghlContact.tags.push("Monthly-Payment");
    } else if (paymentPlan.toLowerCase() === "annual") {
      ghlContact.tags.push("Annual-Payment");
    } else if (
      paymentPlan.toLowerCase() === "undefined" ||
      paymentPlan.toLowerCase() === "unknown"
    ) {
      ghlContact.tags.push("Payment-Plan-Unknown");
    }

    // ============================================================
    // PROCESS COVERAGES
    // ============================================================

    const coverages = safeArray(safeGet(policy, "coverages", []));
    if (coverages.length > 0) {
      const coverageSummary = coverages
        .map((cov) => {
          const desc = cleanString(safeGet(cov, "description", ""));
          const limits = cleanString(safeGet(cov, "limits", ""));
          const deduct = cleanString(safeGet(cov, "deductibles", ""));

          // Check for specific coverage types
          if (desc.toLowerCase().includes("umbrella")) {
            policyTypes.umbrella++;
          }

          // Check liability limits for tagging
          if (desc.toLowerCase().includes("liability") && limits) {
            const limitValue = parseInt(limits.replace(/[^\d]/g, ""));
            if (limitValue && limitValue < 300000) {
              ghlContact.tags.push("Low-Liability-Limits");
            }
          }

          // Check deductibles
          if (deduct) {
            const deductValue = parseInt(deduct.replace(/[^\d]/g, ""));
            if (deductValue && deductValue >= 1000) {
              ghlContact.tags.push("High-Deductible");
            }
          }

          if (!desc) return "";
          return `${desc}: ${limits}${deduct ? ` (Ded: ${deduct})` : ""}`;
        })
        .filter((c) => c)
        .join(" | ");

      if (coverageSummary) {
        ghlContact.customFields[`${prefix}coverages`] = coverageSummary;
      }
    }

    // ============================================================
    // PROCESS VEHICLES (for auto policies)
    // ============================================================

    const autos = safeArray(safeGet(policy, "autos", []));
    if (autos.length > 0) {
      const currentYear = new Date().getFullYear();

      const vehicleList = autos
        .map((auto) => {
          const year = cleanString(safeGet(auto, "year", ""));
          const make = cleanString(safeGet(auto, "make", ""));
          const model = cleanString(safeGet(auto, "model", ""));
          const vin = cleanString(safeGet(auto, "vin", ""));

          // Check for new vehicle
          if (year && parseInt(year) >= currentYear - 1) {
            ghlContact.tags.push("New-Vehicle");
          }

          // Check for luxury brands
          const luxuryBrands = [
            "MERCEDES",
            "BMW",
            "AUDI",
            "LEXUS",
            "PORSCHE",
            "TESLA",
            "CADILLAC",
            "JAGUAR",
          ];
          if (
            luxuryBrands.some((brand) => make.toUpperCase().includes(brand))
          ) {
            ghlContact.tags.push("Luxury-Vehicle");
          }

          if (!year && !make && !model) return "";
          return `${year} ${make} ${model}${vin ? ` (VIN: ${vin})` : ""}`.trim();
        })
        .filter((v) => v)
        .join(" | ");

      if (vehicleList) {
        ghlContact.customFields[`${prefix}vehicles`] = vehicleList;
      }

      // Tag based on number of vehicles
      if (autos.length === 1) {
        ghlContact.tags.push("Single-Vehicle");
      } else if (autos.length > 1) {
        ghlContact.tags.push("Multiple-Vehicles");
      }
    }

    // ============================================================
    // PROCESS DRIVERS
    // ============================================================

    const drivers = safeArray(safeGet(policy, "drivers", []));
    if (drivers.length > 0) {
      const driverList = drivers
        .map((d) => {
          const first = cleanString(safeGet(d, "firstName", ""));
          const last = cleanString(safeGet(d, "lastName", ""));
          const license = cleanString(safeGet(d, "licenseNumber", ""));
          const dob = safeGet(d, "dateOfBirth", "");

          // Check for teen drivers
          if (dob) {
            const driverAge = calculateAge(dob);
            if (driverAge >= 16 && driverAge <= 19) {
              ghlContact.tags.push("Teen-Driver");
            }
          }

          if (!first && !last) return "";
          return `${first} ${last}${license ? ` (Lic: ${license})` : ""}`.trim();
        })
        .filter((d) => d)
        .join(" | ");

      if (driverList) {
        ghlContact.customFields[`${prefix}drivers`] = driverList;
      }
    }

    // ============================================================
    // PROCESS LOCATIONS (for property policies)
    // ============================================================

    const locations = safeArray(safeGet(policy, "locations", []));
    if (locations.length > 0) {
      const activeLocations = locations.filter(
        (loc) => !safeGet(loc, "isArchived", false),
      );

      const locationList = activeLocations
        .map((loc) => {
          const desc = cleanString(safeGet(loc, "description", ""));
          const locAddr = safeGet(loc, "address", {});
          const addr1 = cleanString(safeGet(locAddr, "address1", ""));
          const city = cleanString(safeGet(locAddr, "city", ""));
          const state = cleanString(safeGet(locAddr, "state", ""));

          // Check building details for property characteristics
          const buildings = safeArray(safeGet(loc, "buildings", []));
          buildings.forEach((building) => {
            const personalUnderwriting = safeGet(
              building,
              "personalUnderwriting",
              {},
            );
            const yearBuilt = safeGet(personalUnderwriting, "yearBuilt", 0);
            const purchaseDate = safeGet(
              personalUnderwriting,
              "purchaseDate",
              "",
            );

            if (yearBuilt) {
              const currentYear = new Date().getFullYear();
              if (currentYear - yearBuilt <= 5) {
                ghlContact.tags.push("New-Construction");
              } else if (yearBuilt < 1980) {
                ghlContact.tags.push("Historic-Home");
              }
            }

            // Check if new homeowner
            if (purchaseDate) {
              const daysSincePurchase = daysBetween(purchaseDate, today);
              if (daysSincePurchase <= 365) {
                ghlContact.tags.push("New-Homeowner");

                // Check if first-time buyer (purchase date = inception date)
                if (
                  inceptionDate &&
                  Math.abs(daysBetween(purchaseDate, inceptionDate)) <= 30
                ) {
                  ghlContact.tags.push("First-Time-Buyer");
                }
              }
            }
          });

          if (!desc && !addr1) return "";
          return desc || `${addr1}, ${city}, ${state}`.trim();
        })
        .filter((l) => l)
        .join(" | ");

      if (locationList) {
        ghlContact.customFields[`${prefix}locations`] = locationList;
      }

      // Multiple locations might indicate investment property
      if (activeLocations.length > 1) {
        ghlContact.tags.push("Investment-Property");
      }
    }

    // ============================================================
    // PROCESS LINES OF BUSINESS
    // ============================================================

    const lobs = safeArray(safeGet(policy, "loBs", []));
    if (lobs.length > 0) {
      const lobCodes = lobs
        .map((lob) => cleanString(safeGet(lob, "code", "")))
        .filter((code) => code)
        .join(", ");

      if (lobCodes) {
        ghlContact.customFields[`${prefix}lob_codes`] = lobCodes;
      }
    }
  } catch (policyError) {
    console.log(`Error processing policy ${policyIndex}:`, policyError.message);
  }
});

// ============================================================
// SUMMARY FIELDS
// ============================================================

ghlContact.customFields.total_policies = policies.length;
ghlContact.customFields.total_annual_premium = formatCurrency(totalPremium);
ghlContact.customFields.total_quoted_premium =
  formatCurrency(totalQuotedPremium);
ghlContact.customFields.active_policies_count = activePolicies.length;
ghlContact.customFields.prospect_policies_count = prospectPolicies.length;
ghlContact.customFields.cancelled_policies_count = cancelledPolicies.length;


// ============================================================
// MULTI-POLICY TAGS
// ============================================================

const activePolicyCount = activePolicies.length;
if (activePolicyCount === 0 && prospectPolicies.length > 0) {
  ghlContact.tags.push("Policy-Prospect-Only");
}

if (activePolicyCount === 1) {
  ghlContact.tags.push("Single-Policy");
} else if (activePolicyCount >= 2) {
  ghlContact.tags.push("Multi-Policy");
}

// Bundle tags
if (policyTypes.auto > 0 && policyTypes.home > 0) {
  ghlContact.tags.push("Bundle-Auto-Home");
} else if (policyTypes.auto > 0 && policyTypes.home === 0) {
  ghlContact.tags.push("Auto-Only");
  ghlContact.tags.push("Bundle-Potential");
  ghlContact.tags.push("No-Home-Coverage");
} else if (policyTypes.home > 0 && policyTypes.auto === 0) {
  ghlContact.tags.push("Home-Only");
  ghlContact.tags.push("Bundle-Potential");
  ghlContact.tags.push("No-Auto-Coverage");
}

// Specialty coverage tags
if (policyTypes.earthquake > 0) {
  ghlContact.tags.push("Has-Earthquake");
}
if (policyTypes.umbrella > 0) {
  ghlContact.tags.push("Has-Umbrella");
}
if (policyTypes.life > 0) {
  ghlContact.tags.push("Has-Life");
}

// Cross-sell opportunities
if (policyTypes.auto > 0 && policyTypes.umbrella === 0 && totalPremium > 2000) {
  ghlContact.tags.push("No-Umbrella");
}

if (policyTypes.home > 0 && policyTypes.auto === 0) {
  ghlContact.tags.push("Renter-Potential");
}

if ((policyTypes.auto > 0 || policyTypes.home > 0) && policyTypes.life === 0) {
  if (maritalStatus.toLowerCase() === "married" || primaryPersonAge < 50) {
    ghlContact.tags.push("Life-Insurance-Opportunity");
  }
}

// ============================================================
// PREMIUM VALUE SEGMENTATION
// ============================================================

if (totalPremium >= 5000) {
  ghlContact.tags.push("Premium-Tier-A");
  ghlContact.tags.push("High-Value-Client");
} else if (totalPremium >= 2500) {
  ghlContact.tags.push("Premium-Tier-B");
} else if (totalPremium >= 1000) {
  ghlContact.tags.push("Premium-Tier-C");
} else if (totalPremium > 0) {
  ghlContact.tags.push("Premium-Tier-D");
}

// Growth potential
if (activePolicyCount === 1 && totalPremium < 2000) {
  ghlContact.tags.push("Growth-Potential");
}

// Premium decline check
if (
  totalQuotedPremium > 0 &&
  totalPremium > 0 &&
  totalPremium < totalQuotedPremium * 0.8
) {
  ghlContact.tags.push("Premium-Decline");
}

// ============================================================
// RENEWAL TRACKING TAGS
// ============================================================

if (upcomingRenewals.length > 0) {
  // Sort by days until expiration
  upcomingRenewals.sort((a, b) => a.daysUntil - b.daysUntil);

  const nextRenewal = upcomingRenewals[0];

  if (nextRenewal.daysUntil <= 7) {
    ghlContact.tags.push("Policy-Renewal-7");
  } else if (nextRenewal.daysUntil <= 30) {
    ghlContact.tags.push("Policy-Renewal-30");
  } else if (nextRenewal.daysUntil <= 60) {
    ghlContact.tags.push("Policy-Renewal-Soon");
  }

  ghlContact.customFields.next_renewal_date = formatDate(
    nextRenewal.expirationDate,
  );
  ghlContact.customFields.days_until_renewal = nextRenewal.daysUntil;
}

// ============================================================
// POLICY STATUS ANALYSIS TAGS
// ============================================================

if (prospectPolicies.length > 0) {
  // Check for old prospect policies (not sold)
  const oldProspects = prospectPolicies.filter((p) => {
    if (p.statusDate) {
      return daysBetween(p.statusDate, today) > 30;
    }
    return false;
  });

  if (oldProspects.length > 0) {
    ghlContact.tags.push("Quote-Not-Sold");
  }

  if (prospectPolicies.length > 1) {
    ghlContact.tags.push("Multiple-Quotes");
  }
}

if (cancelledPolicies.length > 0) {
  // Check for recent cancellations
  const recentCancellations = cancelledPolicies.filter((p) => {
    if (p.statusDate) {
      return daysBetween(p.statusDate, today) <= 90;
    }
    return false;
  });

  if (recentCancellations.length > 0) {
    ghlContact.tags.push("Recently-Cancelled");

    // Check cancellation reason
    const insuredRequest = cancelledPolicies.some(
      (p) => p.subStatus && p.subStatus.toLowerCase().includes("insured"),
    );
    if (insuredRequest) {
      ghlContact.tags.push("Cancelled-Insureds-Request");
    }
  }
}

// Mixed status warning
if (hasActivePolicy && (hasCancelledPolicy || hasExpiredPolicy)) {
  ghlContact.tags.push("Mixed-Status");
}

// ============================================================
// CARRIER DIVERSIFICATION TAGS
// ============================================================

if (carriers.size > 1) {
  ghlContact.tags.push("Multiple-Carriers");
}

// ============================================================
// CLIENT LIFECYCLE STATUS
// ============================================================

if (hasActivePolicy) {
  ghlContact.tags.push("Active-Client");

  // Service level tags
  if (totalPremium >= 5000 && ghlContact.tags.includes("Loyal-Client")) {
    ghlContact.tags.push("White-Glove-Service");
  } else {
    ghlContact.tags.push("Standard-Service");
  }

  // Producer tags with status
  if (producer) {
    ghlContact.tags.push(`Producer-${producer}-Active-Client`);
  }
} else if (policies.length === 0 || clientStatus.toLowerCase() === "prospect") {
  ghlContact.tags.push("Prospect");

  if (producer) {
    ghlContact.tags.push(`Producer-${producer}-Prospect`);
  }
} else if (hasExpiredPolicy || hasCancelledPolicy || policies.length > 0) {
  ghlContact.tags.push("Inactive-Client");
}

// Check for unassigned producer/CSR
if (!producer) {
  ghlContact.tags.push("Unassigned-Producer");
  ghlContact.tags.push("Needs-Attention");
}
if (!csr) {
  ghlContact.tags.push("Unassigned-CSR");
}

// ============================================================
// PROCESS CLAIMS
// ============================================================

const claims = safeArray(safeGet(hawksoftClient, "claims", []));
if (claims.length > 0) {
  ghlContact.customFields.total_claims = claims.length;
  ghlContact.tags.push("Has-Claims");
} else {
  ghlContact.customFields.total_claims = 0;
}

// ============================================================
// CONVERT CUSTOM FIELDS TO GHL ARRAY FORMAT
// ============================================================

const customFieldsArray = [];
Object.keys(ghlContact.customFields).forEach((key) => {
  const value = ghlContact.customFields[key];
  if (value !== "" && value !== null && value !== undefined) {
    customFieldsArray.push({
      key: key,
      field_value: String(value),
    });
  }
});

// Replace object with array
delete ghlContact.customFields;
ghlContact.customFields = customFieldsArray;

// Remove duplicate tags
ghlContact.tags = [...new Set(ghlContact.tags)];

return {
  json: {
    ghlContact: ghlContact,
    hawksoftClientId: String(safeGet(hawksoftClient, "clientNumber", "")),
    hawksoftClientGuid: cleanString(safeGet(details, "id", "")),
    syncTimestamp: new Date().toISOString(),
    policiesProcessed: policies.length,
    peopleProcessed: people.length,
    hasEmail: !!email,
    hasPhone: !!phone,
    totalActivePolicies: activePolicies.length,
    totalProspectPolicies: prospectPolicies.length,
    totalPremium: totalPremium,
    upcomingRenewals: upcomingRenewals.length
  },
};
